/**
 * Stall copy + the feature-flag gates the config surface promises.
 *
 * A stall is the one thing the waiting pool cannot say: "still queuing" reads
 * as the model's own latency, while a provider retry, a tool parked on the
 * user's approval or a compaction in flight are different facts — and the
 * approval one means the human, not the model, is being waited on.
 *
 * The feature-gate cases exist because the flags were once parsed but never
 * read: a user's `{"features":{"combo":false}}` silently changed nothing.
 * @module @deepseek-ai/dsh-working-activity/tests/waiting-reason
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityTracker, type ActivityEvent, type TrackerConfig } from '../src/status.ts'
import {
  APPROVAL_PHRASES, COMPACTION_START_PHRASES, CONTINUE_PHRASES, FAIL_PHRASES,
  MODEL_QUIPS, NIGHT_PHRASES, RETRY_PHRASES,
} from '../src/phrases.ts'
import { setLangOverride } from '../src/lang.ts'

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

const CONFIG: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }
const START = 2_000_000

/** Deterministic clock: time moves only when the test says so. */
function fixedClock(): { now: () => number; advance: (ms: number) => void } {
  let current = START
  return { now: () => current, advance: (ms: number) => { current += ms } }
}

describe('stall copy', () => {
  it('says retry instead of the waiting pool while the provider backs off', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(CONFIG, clock.now)
    tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    tracker.onEvent({ kind: 'waiting-reason', at: clock.now(), reason: 'retry' })
    clock.advance(500)
    const state = tracker.render()
    expect(RETRY_PHRASES, `retry copy expected, got ${state.phrase}`).toContain(state.phrase)
    expect(state.line).toContain('总0s')
  })

  it('says approval while a tool is parked on the user, and badges the tool line', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(CONFIG, clock.now)
    tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    tracker.onEvent({
      kind: 'tool-start', at: clock.now(), callId: 'c1', name: 'bash',
      arguments: JSON.stringify({ command: 'npm test' }),
    })
    tracker.onEvent({ kind: 'waiting-reason', at: clock.now(), reason: 'approval' })
    clock.advance(1_000)
    // The tool line keeps the tool itself readable and appends the badge.
    const running = tracker.render()
    expect(running.phase).toBe('tool')
    expect(running.line).toContain('npm test')
    expect(running.line).toContain('在等你批准')
    // Once settled, the badge is gone with the tool.
    tracker.onEvent({ kind: 'tool-end', at: clock.now(), callId: 'c1', failed: false })
    clock.advance(3_000) // past the settled-tool linger
    expect(tracker.render().line).not.toContain('在等你批准')
  })

  it('an explicit approval decision clears the stall before the tool settles', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(CONFIG, clock.now)
    tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    tracker.onEvent({
      kind: 'tool-start', at: clock.now(), callId: 'c1', name: 'bash',
      arguments: JSON.stringify({ command: 'npm test' }),
    })
    tracker.onEvent({ kind: 'waiting-reason', at: clock.now(), reason: 'approval' })
    tracker.onEvent({ kind: 'waiting-cleared', at: clock.now() })
    clock.advance(1_000)
    expect(tracker.render().line).not.toContain('在等你批准')
  })

  it('a streaming token ends the stall', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(CONFIG, clock.now)
    tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    tracker.onEvent({ kind: 'waiting-reason', at: clock.now(), reason: 'retry' })
    tracker.onEvent({ kind: 'stream-delta', at: clock.now(), stream: 'text', text: '⏵ 在修了' })
    clock.advance(500)
    expect(RETRY_PHRASES).not.toContain(tracker.render().phrase)
    expect(tracker.render().line).toContain('⏵ 在修了')
    // Past the narration's freshness window the stall must NOT come back —
    // output flowed, so the waiting pool resumes.
    clock.advance(6_500)
    expect(RETRY_PHRASES, `stall must stay cleared, got ${tracker.render().phrase}`)
      .not.toContain(tracker.render().phrase)
  })

  it('a finished compaction replaces the compaction stall with its quip', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(CONFIG, clock.now)
    tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    tracker.onEvent({ kind: 'waiting-reason', at: clock.now(), reason: 'compaction' })
    expect(COMPACTION_START_PHRASES).toContain(tracker.render().phrase)
    tracker.onEvent({ kind: 'compaction', at: clock.now() })
    expect(COMPACTION_START_PHRASES).not.toContain(tracker.render().phrase)
  })

  it('survives minimal mode — a stall is functional, not decoration', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker({ ...CONFIG, phrases: false }, clock.now)
    tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    tracker.onEvent({ kind: 'waiting-reason', at: clock.now(), reason: 'approval' })
    clock.advance(500)
    expect(APPROVAL_PHRASES).toContain(tracker.render().phrase)
  })

  it('is deterministic across reads and survives a checkpoint', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(CONFIG, clock.now)
    tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    tracker.onEvent({ kind: 'waiting-reason', at: clock.now(), reason: 'retry' })
    clock.advance(1_000)
    const first = tracker.render().line
    const restored = ActivityTracker.restore(CONFIG, clock.now, undefined, tracker.snapshot())
    expect(restored.render().line).toBe(first)
    clock.advance(1_500) // crosses the next whole second: only the elapsed moved
    expect(tracker.render().line).not.toBe(first)
  })
})

describe('one render, one clock', () => {
  it('night copy follows the rendered instant, not the tracker clock', () => {
    // A tracker whose clock supplier says noon, rendered "as of" 03:00 — the
    // copy pools must follow the RENDER instant (one render, one time
    // source); before, night/holiday copy read the clock supplier while the
    // elapsed read the argument, so the two disagreed.
    const noon = Date.parse('2026-03-16T12:00:00+08:00')
    const night = Date.parse('2026-03-16T03:00:00+08:00')
    const nightPool = new Set<string>(NIGHT_PHRASES)
    let found = false
    for (let seed = 0; seed < 400 && !found; seed++) {
      const tracker = new ActivityTracker(CONFIG, () => noon)
      tracker.onEvent({ kind: 'turn-start', at: noon + seed })
      tracker.onEvent({ kind: 'stream-delta', at: noon + seed, stream: 'text', text: 'go' })
      found = nightPool.has(tracker.render(night).phrase ?? '')
    }
    expect(found, 'some deterministic seed must draw night copy at a night instant').toBe(true)
  })
})

describe('feature gates the config promises', () => {
  /** Two quick tool calls in a row, so the combo streak reaches 2. */
  function comboTurn(tracker: ActivityTracker, at: number): void {
    const events: readonly ActivityEvent[] = [
      { kind: 'turn-start', at },
      { kind: 'tool-start', at: at + 100, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' },
      { kind: 'tool-end', at: at + 200, callId: 'c1', failed: false },
      { kind: 'tool-start', at: at + 300, callId: 'c2', name: 'bash', arguments: '{"command":"pwd"}' },
    ]
    for (const event of events) tracker.onEvent(event)
  }

  it('combo=false hides the streak badge', () => {
    const off = new ActivityTracker({ ...CONFIG, features: { combo: false } }, () => START)
    comboTurn(off, START)
    expect(off.render(START + 1_000).line).not.toContain('工具x2')
    const on = new ActivityTracker(CONFIG, () => START)
    comboTurn(on, START)
    expect(on.render(START + 1_000).line).toContain('工具x2')
  })

  it('failPhrases=false renders the plain done prefix on a failed turn', () => {
    const run = (features: TrackerConfig['features']): string => {
      const tracker = new ActivityTracker({ ...CONFIG, features }, () => START)
      tracker.onEvent({ kind: 'turn-start', at: START })
      tracker.onEvent({ kind: 'tool-start', at: START + 100, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' })
      tracker.onEvent({ kind: 'tool-end', at: START + 200, callId: 'c1', failed: true })
      tracker.onEvent({ kind: 'turn-end', at: START + 300 })
      return tracker.render(START + 400).line
    }
    const ungated = run(undefined)
    expect(
      FAIL_PHRASES.some(phrase => ungated.startsWith(phrase)),
      `expected a fail prefix, got ${JSON.stringify(ungated)}`,
    ).toBe(true)
    expect(run({ failPhrases: false }).startsWith('搞定 ✓')).toBe(true)
  })

  it('modelQuips=false stays quiet on a route change', () => {
    const quiet = new ActivityTracker({ ...CONFIG, features: { modelQuips: false } }, () => START)
    quiet.onEvent({ kind: 'turn-start', at: START })
    quiet.onEvent({ kind: 'route-change', at: START + 100, model: 'deepseek-chat' })
    const quips = new Set(MODEL_QUIPS.deepseek)
    expect(quips.has(quiet.render(START + 200).phrase ?? '')).toBe(false)
    const loud = new ActivityTracker(CONFIG, () => START)
    loud.onEvent({ kind: 'turn-start', at: START })
    loud.onEvent({ kind: 'route-change', at: START + 100, model: 'deepseek-chat' })
    expect(quips.has(loud.render(START + 200).phrase ?? '')).toBe(true)
  })

  it('continuePhrases=false stays quiet after an interrupt', () => {
    const quiet = new ActivityTracker({ ...CONFIG, features: { continuePhrases: false } }, () => START)
    quiet.onEvent({ kind: 'turn-start', at: START })
    quiet.onInterrupted()
    expect(CONTINUE_PHRASES).not.toContain(quiet.render(START + 100).phrase)
    const loud = new ActivityTracker(CONFIG, () => START)
    loud.onEvent({ kind: 'turn-start', at: START })
    loud.onInterrupted()
    expect(CONTINUE_PHRASES).toContain(loud.render(START + 100).phrase)
  })
})
