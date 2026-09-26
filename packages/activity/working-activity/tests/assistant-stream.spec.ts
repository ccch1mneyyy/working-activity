/**
 * Live `agent/assistant-stream` adapter tests.
 *
 * These pin the two behaviours that make the realtime half work on the current
 * host line, and both are regressions waiting to happen:
 *
 * 1. **Revision scope is the agent lifecycle.** The host restarts `revision` at
 *    1 when an agent is replaced, so a single process-wide counter would drop
 *    every frame of the replacement (`1 <= 100`) and silence the line forever.
 * 2. **Provisional state is attempt-scoped.** Narration and the token estimate
 *    must not survive into the next attempt, or an abandoned attempt's `⏵` copy
 *    keeps describing work that already stopped.
 * @module @deepseek-ai/dsh-working-activity/tests/assistant-stream
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { frameToActivityEvents } from '../src/compat/assistant-stream.ts'
import { setLangOverride } from '../src/lang.ts'
import { ActivityTracker, type TrackerConfig } from '../src/status.ts'

// Deterministic language, matching the other suites: the ambient machine may
// carry DSH_TUI_LANG or a persisted ~/.dsh-tui/lang.json. The stream owners are
// re-created per case because the revision cursor is keyed by the agent OBJECT
// and lives as long as that identity does — exactly the production semantics,
// where a replaced agent is a different object. Reusing one owner across cases
// would carry revisions over and make later frames look stale.
let ownerA: object
let ownerB: object

beforeEach(() => {
  setLangOverride('zh')
  ownerA = { name: 'agent-a' }
  ownerB = { name: 'agent-b' }
})
afterEach(() => setLangOverride('auto'))

const CONFIG: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }

/** One `start` frame. */
function start(revision: number, attemptId = 'attempt-1'): Record<string, unknown> {
  return { type: 'start', attemptId, revision, turn: 1, step: 1 }
}

/** One `chunk` frame carrying a text delta. */
function textChunk(
  revision: number,
  text: string,
  options: { attemptId?: string; index?: number; time?: number } = {},
): Record<string, unknown> {
  const { attemptId = 'attempt-1', index = 0, time = 1_700_000_000_000 } = options
  return {
    type: 'chunk',
    attemptId,
    revision,
    index,
    time,
    chunk: { type: 'text-delta', index: 0, text },
  }
}

/** One `chunk` frame carrying a reasoning delta. */
function reasoningChunk(revision: number, text: string): Record<string, unknown> {
  return {
    type: 'chunk',
    attemptId: 'attempt-1',
    revision,
    index: 0,
    time: 1_700_000_000_000,
    chunk: { type: 'reasoning-delta', index: 0, text },
  }
}

/** One `end` frame. */
function end(revision: number, outcome: Record<string, unknown>, attemptId = 'attempt-1'): Record<string, unknown> {
  return { type: 'end', attemptId, revision, index: 0, outcome }
}

/** Commit outcome of a full assistant message. */
const COMMITTED_MESSAGE = { kind: 'committed', eventType: 'assistant/message', seq: 9 }
/** Commit outcome of a partial attempt settlement. */
const COMMITTED_ATTEMPT = { kind: 'committed', eventType: 'assistant/attempt', seq: 9 }

describe('assistant-stream frame normalization', () => {
  it('maps start and text chunk frames to domain events', () => {
    expect(frameToActivityEvents(ownerA, start(1))).toEqual([
      { kind: 'stream-start', at: expect.any(Number), attemptId: 'attempt-1' },
    ])
    expect(frameToActivityEvents(ownerA, textChunk(2, 'hello'))).toEqual([
      { kind: 'stream-delta', at: 1_700_000_000_000, stream: 'text', text: 'hello' },
    ])
  })

  it('maps reasoning deltas to the reasoning stream', () => {
    frameToActivityEvents(ownerB, start(1))
    expect(frameToActivityEvents(ownerB, reasoningChunk(2, '嗯'))).toEqual([
      { kind: 'stream-delta', at: 1_700_000_000_000, stream: 'reasoning', text: '嗯' },
    ])
  })

  it('ignores every non-delta chunk kind', () => {
    frameToActivityEvents(ownerA, start(1))
    const nonDeltas = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
      { type: 'tool-call-delta', index: 0, id: 'c1', argumentsDelta: '{}' },
    ]
    nonDeltas.forEach((chunk, index) => {
      const events = frameToActivityEvents(ownerA, {
        type: 'chunk', attemptId: 'attempt-1', revision: 10 + index, index, time: 5, chunk,
      })
      expect(events).toEqual([])
    })
  })

  it('ignores empty delta text', () => {
    frameToActivityEvents(ownerA, start(1))
    expect(frameToActivityEvents(ownerA, textChunk(2, ''))).toEqual([])
  })

  it('does not treat a committed assistant message as an abandonment', () => {
    frameToActivityEvents(ownerA, start(1))
    frameToActivityEvents(ownerA, textChunk(2, 'done'))
    // The streamed text IS the committed message; dropping it would blank the
    // narration before its freshness window expired.
    expect(frameToActivityEvents(ownerA, end(3, COMMITTED_MESSAGE))).toEqual([])
  })

  it('reports an abandoned attempt as abandoned', () => {
    frameToActivityEvents(ownerA, start(1))
    expect(frameToActivityEvents(ownerA, end(2, { kind: 'abandoned' }))).toEqual([
      { kind: 'stream-reset', at: expect.any(Number), reason: 'abandoned' },
    ])
  })

  it('reports a partial attempt settlement as attempt-settled, never abandoned', () => {
    frameToActivityEvents(ownerA, start(1))
    expect(frameToActivityEvents(ownerA, end(2, COMMITTED_ATTEMPT))).toEqual([
      { kind: 'stream-reset', at: expect.any(Number), reason: 'attempt-settled' },
    ])
  })

  it('forgets the attempt on an unrecognized outcome without discarding narration', () => {
    frameToActivityEvents(ownerA, start(1))
    expect(frameToActivityEvents(ownerA, end(2, { kind: 'something-new' }))).toEqual([])
    // The attempt is forgotten, so a late chunk of it is adopted as a new one.
    const adopted = frameToActivityEvents(ownerA, textChunk(3, 'x'))
    expect(adopted.map(event => event.kind)).toEqual(['stream-start', 'stream-delta'])
  })
})

describe('stream ordering', () => {
  it('drops a revision it has already seen', () => {
    frameToActivityEvents(ownerA, start(1))
    expect(frameToActivityEvents(ownerA, textChunk(2, 'first'))).toHaveLength(1)
    expect(frameToActivityEvents(ownerA, textChunk(2, 'first'))).toEqual([])
  })

  it('drops an out-of-order revision', () => {
    frameToActivityEvents(ownerA, start(5))
    frameToActivityEvents(ownerA, textChunk(6, 'second'))
    expect(frameToActivityEvents(ownerA, textChunk(3, 'stale'))).toEqual([])
  })

  it('accepts frames without a revision instead of freezing the line', () => {
    frameToActivityEvents(ownerA, start(1))
    const noRevision = textChunk(2, 'unversioned')
    delete (noRevision as { revision?: number }).revision
    expect(frameToActivityEvents(ownerA, noRevision)).toHaveLength(1)
  })

  it('accepts revision 1 of a replacement agent after a long-lived one', () => {
    // The regression this file exists for: revision is monotone WITHIN one
    // agent lifecycle and restarts on replacement.
    for (let revision = 1; revision <= 100; revision++) {
      frameToActivityEvents(ownerA, textChunk(revision, `a${revision}`))
    }
    const replacement = frameToActivityEvents(ownerB, start(1))
    expect(replacement).toHaveLength(1)
    expect(frameToActivityEvents(ownerB, textChunk(2, 'b'))).toHaveLength(1)
  })

  it('adopts a chunk whose attempt was never opened (reattached stream)', () => {
    const events = frameToActivityEvents(ownerA, textChunk(7, 'joined mid-attempt'))
    expect(events.map(event => event.kind)).toEqual(['stream-start', 'stream-delta'])
  })

  it('opens the announced attempt when a chunk names a different one', () => {
    frameToActivityEvents(ownerA, start(1))
    const events = frameToActivityEvents(ownerA, textChunk(2, 'next', { attemptId: 'attempt-2' }))
    expect(events[0]).toMatchObject({ kind: 'stream-start', attemptId: 'attempt-2' })
    expect(events[1]).toMatchObject({ kind: 'stream-delta', text: 'next' })
  })
})

describe('malformed frames', () => {
  it('never throws and never emits for unreadable payloads', () => {
    const payloads: unknown[] = [
      undefined, null, {}, [], 'frame', 42,
      { type: 'unknown' }, { type: 'start' }, { type: 'chunk' }, { type: 'end' },
      { type: 'chunk', chunk: null }, { type: 'chunk', chunk: { type: 'text-delta' } },
      { type: 'end', outcome: null },
    ]
    for (const payload of payloads) {
      expect(() => frameToActivityEvents(ownerA, payload)).not.toThrow()
    }
    expect(frameToActivityEvents(ownerA, { type: 'unknown' })).toEqual([])
  })

  it('falls back to the wall clock when a frame carries no timestamp', () => {
    const before = Date.now()
    const [event] = frameToActivityEvents(ownerA, { type: 'start', revision: 1 })
    expect(event.at).toBeGreaterThanOrEqual(before)
    expect(event.at).toBeLessThanOrEqual(Date.now())
  })
})

describe('feeding a tracker from live frames', () => {
  /** A tracker on a deterministic clock. */
  function trackerAt(now: number): {
    tracker: ActivityTracker
    now: () => number
    advance: (ms: number) => void
  } {
    let current = now
    return {
      tracker: new ActivityTracker(CONFIG, () => current),
      now: () => current,
      advance: (ms: number) => { current += ms },
    }
  }

  /** Feed frames through the adapter exactly as the plugin does. */
  function feed(tracker: ActivityTracker, owner: object, frames: readonly unknown[]): void {
    for (const frame of frames) {
      for (const event of frameToActivityEvents(owner, frame)) tracker.onEvent(event)
    }
  }

  it('promotes waiting → thinking on the first streamed token and shows the narration', () => {
    const clock = trackerAt(1_700_000_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    expect(clock.tracker.render().phase).toBe('waiting')

    feed(clock.tracker, ownerA, [start(1), textChunk(2, '⏵ 正在修登录页样式')])
    const state = clock.tracker.render()
    expect(state.phase).toBe('thinking')
    expect(state.line).toContain('⏵ 正在修登录页样式')
    expect(state.phrase).toBe('正在修登录页样式')
  })

  it('keeps an abandoned attempt out of the next attempt narration', () => {
    const clock = trackerAt(1_700_000_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    feed(clock.tracker, ownerA, [start(1), textChunk(2, '⏵ 改 A'), end(3, { kind: 'abandoned' })])
    // The abandoned attempt's narration is wrong the moment it is abandoned, so
    // it must be gone immediately — not merely superseded later.
    expect(clock.tracker.render().line).not.toContain('改 A')

    // Attempt B opens with a higher revision and its own attempt id.
    feed(clock.tracker, ownerA, [
      start(4, 'attempt-2'),
      textChunk(5, '⏵ 改 B', { attemptId: 'attempt-2' }),
    ])
    const line = clock.tracker.render().line
    expect(line).toContain('改 B')
    expect(line).not.toContain('改 A')
  })

  it('does not inherit streamed text when a new attempt opens without a reset', () => {
    const clock = trackerAt(1_700_000_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    // Committed message: no reset event, so only the next attempt's start
    // clears the provisional buffer.
    feed(clock.tracker, ownerA, [start(1), textChunk(2, '⏵ 第一段'), end(3, COMMITTED_MESSAGE)])
    feed(clock.tracker, ownerA, [
      start(4, 'attempt-2'),
      textChunk(5, '⏵ 第二段', { attemptId: 'attempt-2' }),
    ])
    expect(clock.tracker.render().line).toContain('第二段')
  })

  it('returns to waiting after an abandonment with no tool running', () => {
    const clock = trackerAt(1_700_000_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    feed(clock.tracker, ownerA, [start(1), textChunk(2, '⏵ 试试'), end(3, { kind: 'abandoned' })])
    expect(clock.tracker.render().phase).toBe('waiting')
  })

  it('keeps the tool phase when an attempt is abandoned mid-tool', () => {
    const clock = trackerAt(1_700_000_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: clock.now() })
    clock.tracker.onEvent({ kind: 'tool-start', at: clock.now(), callId: 'c1', name: 'bash', arguments: '{}' })
    feed(clock.tracker, ownerA, [start(1), textChunk(2, '⏵ 等结果'), end(3, { kind: 'abandoned' })])
    expect(clock.tracker.render().phase).toBe('tool')
  })
})
