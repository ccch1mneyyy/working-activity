/**
 * Wake-boundary tests for `ActivityTracker.nextWakeAt`.
 *
 * The plugin sleeps until this instant instead of polling, so an over-estimate
 * would freeze the line and an under-estimate would only cost an extra redraw.
 * These cases pin the boundary of every phase the line can be in, including the
 * two that must NOT arm a timer at all (idle and a settled done card).
 * @module @deepseek-ai/dsh-working-activity/tests/wake
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLangOverride } from '../src/lang.ts'
import { ActivityTracker, type TrackerConfig } from '../src/status.ts'

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

const LIVE: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }
const PLAIN: TrackerConfig = { phrases: false, detailLimit: 40, showIdle: false }

/** A tracker on a clock the test drives. */
function trackerAt(config: TrackerConfig, start: number): {
  tracker: ActivityTracker
  now: () => number
} {
  let current = start
  return { tracker: new ActivityTracker(config, () => current), now: () => current }
}

describe('nextWakeAt: states that never wake on their own', () => {
  it('returns nothing while idle', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    expect(clock.tracker.nextWakeAt()).toBeUndefined()
  })

  it('returns nothing for a turn that ended without tools', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    clock.tracker.onEvent({ kind: 'turn-end', at: 1_001_000 })
    expect(clock.tracker.render().phase).toBe('done')
    expect(clock.tracker.nextWakeAt()).toBeUndefined()
  })

  it('returns nothing once the done card has swapped to its summary', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    clock.tracker.onEvent({ kind: 'tool-start', at: 1_000_100, callId: 'c1', name: 'bash', arguments: '{}' })
    clock.tracker.onEvent({ kind: 'tool-end', at: 1_002_000, callId: 'c1', failed: false })
    clock.tracker.onEvent({ kind: 'turn-end', at: 1_002_100 })
    // The fragment window closes 3 s after the last tool ended.
    expect(clock.tracker.nextWakeAt()).toBe(1_002_000 + 3000)
    expect(clock.tracker.nextWakeAt(1_005_001)).toBeUndefined()
  })
})

describe('nextWakeAt: live phases wake on the displayed second', () => {
  it('wakes at the next whole second of the turn', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    expect(clock.tracker.render().phase).toBe('waiting')
    expect(clock.tracker.nextWakeAt(1_000_000)).toBe(1_001_000)
    expect(clock.tracker.nextWakeAt(1_000_400)).toBe(1_001_000)
    expect(clock.tracker.nextWakeAt(1_001_000)).toBe(1_002_000)
  })

  it('wakes at the next whole second of the running tool', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    clock.tracker.onEvent({ kind: 'tool-start', at: 1_000_700, callId: 'c1', name: 'bash', arguments: '{}' })
    expect(clock.tracker.render().phase).toBe('tool')
    expect(clock.tracker.nextWakeAt(1_000_700)).toBe(1_001_700)
  })

  it('still wakes on the second when phrases are off', () => {
    const clock = trackerAt(PLAIN, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    expect(clock.tracker.nextWakeAt(1_000_000)).toBe(1_001_000)
  })
})

describe('nextWakeAt: windows that close before the next second', () => {
  it('wakes when the narration window closes', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    clock.tracker.onEvent({ kind: 'stream-delta', at: 1_000_300, stream: 'text', text: '⏵ 修样式' })
    // Narration expires 5 s after the last delta — 200 ms BEFORE the next whole
    // second, so waking on the second alone would leave stale copy on screen.
    expect(clock.tracker.nextWakeAt(1_005_100)).toBe(1_005_300)
  })

  it('wakes when a tok/s estimate ages out', () => {
    const clock = trackerAt({ ...LIVE, showTokPerSec: true }, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    clock.tracker.onEvent({ kind: 'stream-delta', at: 1_000_300, stream: 'text', text: '中文中文中文' })
    // The tps window is 3.5 s, so it closes before the narration's 5 s.
    expect(clock.tracker.nextWakeAt(1_003_600)).toBe(1_003_800)
  })

  it('wakes when a one-off quip expires', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    clock.tracker.onEvent({ kind: 'stream-delta', at: 1_000_000, stream: 'reasoning', text: '嗯' })
    clock.tracker.onInterrupted()
    // Quips live 6 s; asking 5.9 s later must return the quip expiry, not the
    // second boundary that follows it.
    expect(clock.tracker.nextWakeAt(1_005_900)).toBe(1_006_000)
  })
})

describe('nextWakeAt: the phrase rotation participates', () => {
  it('never reports a rotation deadline before the first render', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    // No render yet: only the second boundary is known, and it is in the future.
    expect(clock.tracker.nextWakeAt(1_000_000)).toBe(1_001_000)
  })

  it('reports a bounded deadline after renders have started', () => {
    const clock = trackerAt(LIVE, 1_000_000)
    clock.tracker.onEvent({ kind: 'turn-start', at: 1_000_000 })
    clock.tracker.render()
    const wake = clock.tracker.nextWakeAt(1_000_100)
    expect(wake).toBeDefined()
    expect(wake!).toBeGreaterThan(1_000_100)
    expect(wake!).toBeLessThanOrEqual(1_001_000)
  })
})
