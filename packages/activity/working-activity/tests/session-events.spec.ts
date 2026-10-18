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

describe('HUD signal vocabulary', () => {
  it('maps request/context to the advertised window', () => {
    expect(toActivityEvents(event('request/context', START, { contextWindow: 128_000 }))).toEqual([
      { kind: 'context-window', at: START, window: 128_000 },
    ])
    expect(toActivityEvents(event('request/context', START, { contextWindow: 0 }))).toEqual([])
    expect(toActivityEvents(event('request/context', START, {}))).toEqual([])
  })

  it('maps todo/write to whole-list counts', () => {
    expect(toActivityEvents(event('todo/write', START, {
      todos: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ],
    }))).toEqual([
      { kind: 'todo-write', at: START, counts: { done: 1, total: 3, inProgress: 1 } },
    ])
  })

  it('maps job registration and settlement', () => {
    expect(toActivityEvents(event('job/registered', START, {
      jobId: 'bash-1', kind: 'bash', label: 'npm test', startedAt: START,
    }))).toEqual([{
      kind: 'job-start', at: START,
      job: { id: 'bash-1', kind: 'bash', label: 'npm test', startedAt: START },
    }])
    expect(toActivityEvents(event('job/settled', START, { jobId: 'bash-1' }))).toEqual([
      { kind: 'job-end', at: START, jobId: 'bash-1' },
    ])
  })

  it('maps subagent catalog, team members and team tasks', () => {
    expect(toActivityEvents(event('subagent/catalog', START, {
      childId: 's1', mode: 'continuable', label: 'audit',
    }))).toEqual([{
      kind: 'subagent-catalog', at: START,
      subagent: { id: 's1', mode: 'continuable', label: 'audit' },
    }])
    expect(toActivityEvents(event('team/member', START, {
      member: { id: 'm1', name: 'worker', phase: 'active' },
    }))).toEqual([{
      kind: 'team-member', at: START,
      member: { id: 'm1', name: 'worker', phase: 'active' },
    }])
    expect(toActivityEvents(event('team/task', START, {
      task: { id: 't1', status: 'in_progress', subject: 'fix' },
    }))).toEqual([{
      kind: 'team-task', at: START,
      task: { id: 't1', status: 'in_progress', subject: 'fix' },
    }])
  })

  it('maps goal create/clear and plan mode', () => {
    expect(toActivityEvents(event('goal/change', START, {
      operation: 'create',
      goal: { phase: 'active', maxGoalRounds: 10 },
      roundsStarted: 2,
    }))).toEqual([{
      kind: 'goal-change', at: START,
      goal: { phase: 'active', rounds: 2, maxRounds: 10 },
    }])
    expect(toActivityEvents(event('goal/change', START, { operation: 'clear' }))).toEqual([
      { kind: 'goal-change', at: START },
    ])
    expect(toActivityEvents(event('plan/mode', START, { active: true }))).toEqual([
      { kind: 'plan-mode', at: START, plan: { active: true } },
    ])
  })
})

describe('queued input', () => {
  it('maps inbox splices to a signed queued count', () => {
    expect(toActivityEvents(event('agent/inbox/spliced', START, {
      target: 'next-turn', start: 0, removedCount: 0, inserted: [{ id: 'm1' }, { id: 'm2' }],
    }))).toEqual([{ kind: 'queue-change', at: START, target: 'next-turn', delta: 2 }])
    expect(toActivityEvents(event('agent/inbox/spliced', START, {
      target: 'next-step', start: 0, removedCount: 1, inserted: [],
    }))).toEqual([{ kind: 'queue-change', at: START, target: 'next-step', delta: -1 }])
    expect(toActivityEvents(event('agent/inbox/spliced', START, { target: 'other', inserted: [] }))).toEqual([])
  })
})
