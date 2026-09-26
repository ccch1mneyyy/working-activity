/**
 * Durable-event normalization for the two signals the TUI used to feed in by
 * hand: a model route change and a finished compaction.
 *
 * Both are derivable from the log, which is what lets the plugin own them
 * instead of every carrier wiring its own listeners:
 *
 * - `model/selection` is the host's validated selection record (declared by the
 *   session controller's module merge, hence compared as a widened string).
 * - A compaction's replacement user message carries the
 *   `compact-checkpoint` message source.
 *
 * The tracker-level case pins the dedupe: the same model logged twice (a
 * re-selection, or a replay) must not re-quip, while a genuine change must.
 * @module @deepseek-ai/dsh-working-activity/tests/session-events
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toActivityEvents } from '../src/compat/session-events.ts'
import { setLangOverride } from '../src/lang.ts'
import { ActivityTracker, type TrackerConfig } from '../src/status.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

const CONFIG: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }
const START = new Date('2026-03-16T12:00:00').getTime()

/** A durable event with a chosen type and payload. */
function event(type: string, time: number, data: unknown = {}): SessionEvent {
  return { type, seq: 0, time, data } as unknown as SessionEvent
}

describe('stall vocabulary', () => {
  it('maps llm retries to a retry stall', () => {
    expect(toActivityEvents(event('llm/retry', START))).toEqual([
      { kind: 'waiting-reason', at: START, reason: 'retry' },
    ])
    expect(toActivityEvents(event('llm/retry-started', START))).toEqual([
      { kind: 'waiting-reason', at: START, reason: 'retry' },
    ])
  })

  it('maps approval ask/decide onto the stall and its clear', () => {
    expect(toActivityEvents(event('approval/asked', START))).toEqual([
      { kind: 'waiting-reason', at: START, reason: 'approval' },
    ])
    expect(toActivityEvents(event('approval/decided', START))).toEqual([
      { kind: 'waiting-cleared', at: START },
    ])
  })

  it('maps compaction start to a compaction stall', () => {
    expect(toActivityEvents(event('compaction/start', START))).toEqual([
      { kind: 'waiting-reason', at: START, reason: 'compaction' },
    ])
  })
})

describe('model selection', () => {
  it('normalizes a validated selection into a route change', () => {
    const events = toActivityEvents(event('model/selection', START, {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    }))
    expect(events).toEqual([{ kind: 'route-change', at: START, model: 'deepseek-v4-flash' }])
  })

  it('drops a selection without a usable model id', () => {
    expect(toActivityEvents(event('model/selection', START, { provider: 'deepseek' }))).toEqual([])
    expect(toActivityEvents(event('model/selection', START, { model: '' }))).toEqual([])
    expect(toActivityEvents(event('model/selection', START, { model: 42 }))).toEqual([])
  })
})

describe('compaction', () => {
  it('normalizes a checkpoint replacement message into a compaction', () => {
    const events = toActivityEvents(event('user/message', START, {
      message: {
        role: 'user',
        id: 'm1',
        content: [{ type: 'text', text: '<compacted context>' }],
        source: { kind: 'compact-checkpoint', compactionId: 'c1' },
      },
    }))
    expect(events).toEqual([{ kind: 'compaction', at: START }])
  })

  it('leaves an ordinary user message unmodelled', () => {
    // The tracker has no use for user text: the line is derived from turns,
    // tools and the model's own narration.
    expect(toActivityEvents(event('user/message', START, {
      message: { role: 'user', id: 'm2', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } },
    }))).toEqual([])
    expect(toActivityEvents(event('user/message', START, {}))).toEqual([])
    expect(toActivityEvents(event('user/message', START, { message: { source: { kind: 'other' } } }))).toEqual([])
  })
})

describe('model quips', () => {
  /** A tracker with a fixed clock. */
  function tracker(): { tracker: ActivityTracker; at: (ms: number) => void } {
    let now = START
    const instance = new ActivityTracker(CONFIG, () => now)
    instance.onEvent({ kind: 'turn-start', at: START })
    return { tracker: instance, at: (ms: number) => { now = ms } }
  }

  it('quips on a change, not on a repeat of the same model', () => {
    const { tracker: state, at } = tracker()
    state.onEvent({ kind: 'route-change', at: START, model: 'deepseek-v4-flash' })
    const first = state.render(START).phrase

    // Past the quip window, the same selection arrives again (a re-selection or
    // a replay): it must not re-announce the model.
    at(START + 20_000)
    state.onEvent({ kind: 'route-change', at: START + 20_000, model: 'deepseek-v4-flash' })
    const repeat = state.render(START + 20_000).phrase

    at(START + 40_000)
    state.onEvent({ kind: 'route-change', at: START + 40_000, model: 'deepseek-v4-pro' })
    const changed = state.render(START + 40_000).phrase

    expect(changed).not.toBe(repeat)
    // The repeat is a normal thinking phrase, not the model quip replayed.
    if (first !== undefined) expect(repeat).not.toBe(first)
  })

  it('does not extend an announcement when the same model is re-selected', () => {
    // The observable that pins the dedupe is the quip WINDOW, not the quip text
    // (the pool is random): a repeat that re-announced the model would push the
    // window out again and the quip would still be on screen late.
    const { tracker: state, at } = tracker()
    state.onEvent({ kind: 'route-change', at: START, model: 'deepseek-v4-flash' })
    const announced = state.render(START).phrase
    expect(announced).toBeDefined()

    const late = START + 60_000
    at(late - 1_000)
    state.onEvent({ kind: 'route-change', at: late - 1_000, model: 'deepseek-v4-flash' })
    at(late)
    expect(state.render(late).phrase).not.toBe(announced)
  })

  it('keeps the dedupe across a snapshot round trip', () => {
    let now = START
    const state = new ActivityTracker(CONFIG, () => now)
    state.onEvent({ kind: 'turn-start', at: START })
    state.onEvent({ kind: 'route-change', at: START, model: 'deepseek-v4-flash' })
    const announced = state.render(START).phrase
    expect(announced).toBeDefined()

    // The remembered model is part of the state: a restored tracker must still
    // refuse to re-announce a selection it already made, or every checkpoint
    // restore would replay the quip.
    const restored = ActivityTracker.restore(CONFIG, () => now, undefined, state.snapshot())
    const late = START + 60_000
    now = late - 1_000
    restored.onEvent({ kind: 'route-change', at: late - 1_000, model: 'deepseek-v4-flash' })
    now = late
    expect(restored.render(late).phrase).not.toBe(announced)
  })
})
