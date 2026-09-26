/**
 * Tracker snapshot / restore tests.
 *
 * A projection checkpoint must resume folding without replaying a session's
 * whole log, so these cases pin the three properties that makes the mechanism
 * trustworthy: a restored tracker renders identically, it keeps folding
 * identically, and it is fully detached from the value it was restored from.
 *
 * Two determinism rules make "renders identically" a real assertion rather than
 * two rolls of the dice:
 *
 * 1. **`Math.random` is pinned.** The phrase, easter-egg and completion pools
 *    draw at random, so two independent trackers would legitimately print
 *    different copy. With one fixed draw both copies must agree exactly.
 * 2. **The clock is an ordinary Monday noon.** A clock near the epoch lands on
 *    New Year's Day, whose holiday pool is date-matched and would fire a
 *    once-per-turn egg — interesting copy, useless as a comparison.
 * @module @deepseek-ai/dsh-working-activity/tests/snapshot
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLangOverride } from '../src/lang.ts'
import {
  ActivityTracker,
  TRACKER_SNAPSHOT_VERSION,
  type ActivityEvent,
  type TrackerConfig,
} from '../src/status.ts'

/** Ordinary weekday noon (2026-03-16, Monday) — no holiday, no weekend egg. */
const START = new Date('2026-03-16T12:00:00').getTime()

beforeEach(() => {
  setLangOverride('zh')
  vi.spyOn(Math, 'random').mockReturnValue(0.42)
})
afterEach(() => {
  vi.restoreAllMocks()
  setLangOverride('auto')
})

const CONFIG: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }

/** A clock the test drives, so rendered elapsed text is deterministic. */
function clock(start = START): {
  now: () => number
  advance: (ms: number) => void
} {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => { current += ms },
  }
}

/** A turn that exercises tools, streaming, failures and the done summary. */
function scriptedTurn(from: number): readonly ActivityEvent[] {
  return [
    { kind: 'turn-start', at: from },
    { kind: 'stream-delta', at: from + 200, stream: 'text', text: '⏵ 看看结构' },
    { kind: 'tool-start', at: from + 500, callId: 'c1', name: 'bash', arguments: '{"command":"npm test"}' },
    { kind: 'tool-end', at: from + 2500, callId: 'c1', failed: false },
    { kind: 'tool-start', at: from + 3000, callId: 'c2', name: 'read', arguments: '{"file_path":"src/index.ts"}' },
    { kind: 'tool-end', at: from + 3200, callId: 'c2', failed: true },
    { kind: 'assistant-settled', at: from + 3300, usage: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 7 } },
    { kind: 'stream-delta', at: from + 3400, stream: 'text', text: '⏵ 收尾' },
  ]
}

/** A second turn, folded after a snapshot was taken. */
function laterTurn(from: number): readonly ActivityEvent[] {
  return [
    { kind: 'tool-start', at: from, callId: 'c3', name: 'grep', arguments: '{"pattern":"todo"}' },
    { kind: 'tool-end', at: from + 900, callId: 'c3', failed: false },
    { kind: 'turn-end', at: from + 1200, interrupted: false },
  ]
}

/** Build a tracker on a clock and fold a sequence into it. */
function folded(sequence: readonly ActivityEvent[], start = START): ActivityTracker {
  const tracker = new ActivityTracker(CONFIG, clock(start).now)
  for (const event of sequence) tracker.onEvent(event)
  return tracker
}

describe('tracker snapshots', () => {
  it('round-trips a live turn without changing anything observable', () => {
    const source = folded(scriptedTurn(START))
    source.render(START + 3600)

    const restored = ActivityTracker.restore(CONFIG, clock().now, undefined, source.snapshot())
    const at = START + 4000
    expect(restored.render(at)).toEqual(source.render(at))
    expect(restored.stats()).toEqual(source.stats())
    expect(restored.nextWakeAt(at)).toBe(source.nextWakeAt(at))
  })

  it('round-trips an idle tracker', () => {
    const source = new ActivityTracker(CONFIG, clock().now)
    const restored = ActivityTracker.restore(CONFIG, clock().now, undefined, source.snapshot())
    expect(restored.render(START)).toEqual(source.render(START))
    expect(restored.nextWakeAt(START)).toBeUndefined()
  })

  it('keeps folding identically after a restore', () => {
    const continuous = folded(scriptedTurn(START))
    // Render before snapshotting so the first phrase draw is part of the state
    // rather than something each copy does on its own.
    continuous.render(START + 3600)
    const resumed = ActivityTracker.restore(CONFIG, clock().now, undefined, continuous.snapshot())

    for (const event of laterTurn(START + 5000)) {
      continuous.onEvent(event)
      resumed.onEvent(event)
    }
    const at = START + 9000
    expect(resumed.render(at)).toEqual(continuous.render(at))
    expect(resumed.stats()).toEqual(continuous.stats())
    expect(resumed.nextWakeAt(at)).toBe(continuous.nextWakeAt(at))
  })

  it('detaches the restored tracker from the value it came from', () => {
    const snapshot = folded(scriptedTurn(START)).snapshot()
    const first = ActivityTracker.restore(CONFIG, clock().now, undefined, snapshot)
    const second = ActivityTracker.restore(CONFIG, clock().now, undefined, snapshot)

    // Drive one copy far enough to mutate every mutable collection it owns.
    for (const event of laterTurn(START + 5000)) first.onEvent(event)
    first.onEvent({ kind: 'tool-start', at: START + 6000, callId: 'c9', name: 'bash', arguments: '{}' })

    // The checkpoint and every copy of it are untouched.
    const expected = folded(scriptedTurn(START)).render(START + 4000)
    expect(second.render(START + 4000)).toEqual(expected)
    const reused = ActivityTracker.restore(CONFIG, clock().now, undefined, snapshot)
    expect(reused.render(START + 4000)).toEqual(expected)
  })

  it('survives a JSON round trip', () => {
    const source = folded(scriptedTurn(START))
    source.render(START + 3600)
    const wire = JSON.parse(JSON.stringify(source.snapshot())) as unknown
    const restored = ActivityTracker.restore(CONFIG, clock().now, undefined, wire)
    expect(restored.render(START + 4000)).toEqual(source.render(START + 4000))
  })

  it('refuses a payload it cannot interpret instead of rendering nonsense', () => {
    expect(() => ActivityTracker.restore(CONFIG, Date.now, undefined, undefined)).toThrow(/unsupported tracker snapshot/)
    expect(() => ActivityTracker.restore(CONFIG, Date.now, undefined, null)).toThrow(/unsupported tracker snapshot/)
    expect(() => ActivityTracker.restore(CONFIG, Date.now, undefined, {})).toThrow(/unsupported tracker snapshot/)
    expect(() => ActivityTracker.restore(CONFIG, Date.now, undefined, { version: 999 })).toThrow(/unsupported tracker snapshot/)
    // The version gate is the compatibility handle the projection relies on.
    expect(() => ActivityTracker.restore(CONFIG, Date.now, undefined, { version: TRACKER_SNAPSHOT_VERSION - 1 }))
      .toThrow(/unsupported tracker snapshot/)
  })

  it('restores the paused-quip and narration windows', () => {
    const tick = clock()
    const source = new ActivityTracker(CONFIG, tick.now)
    source.onEvent({ kind: 'turn-start', at: START })
    source.onEvent({ kind: 'stream-delta', at: START + 100, stream: 'text', text: '⏵ 修样式' })
    source.onInterrupted()
    source.render(START + 200)

    const restored = ActivityTracker.restore(CONFIG, tick.now, undefined, source.snapshot())
    expect(restored.render(START + 500)).toEqual(source.render(START + 500))

    // The quip window is state, not a running timer: past its expiry both copies
    // move on together (to the same copy, with the draw pinned).
    tick.advance(10_000)
    expect(restored.render()).toEqual(source.render())
  })

  it('restores a settled done card, including its drawn copy', () => {
    const tick = clock()
    const source = new ActivityTracker(CONFIG, tick.now)
    for (const event of scriptedTurn(START)) source.onEvent(event)
    source.onEvent({ kind: 'turn-end', at: START + 4000, interrupted: false })
    const settled = source.render(START + 10_000)

    const restored = ActivityTracker.restore(CONFIG, tick.now, undefined, source.snapshot())
    expect(restored.render(START + 10_000)).toEqual(settled)
    expect(restored.nextWakeAt(START + 10_000)).toBe(source.nextWakeAt(START + 10_000))
  })
})
