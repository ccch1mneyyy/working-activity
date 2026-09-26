/**
 * Read purity regressions: the projected line must be a function of its state.
 *
 * The line is READ far more often than it is written — the TUI re-reads it
 * every 500 ms so the elapsed seconds advance, a browser ticks it, the host
 * validates it — so anything random or stateful inside a read shows up as copy
 * that churns on its own. Three real symptoms came from exactly that (reported
 * from a live session):
 *
 * 1. "the copy keeps popping, and fast" — every read rolled a new phrase,
 *    because the rotation state lived on a throwaway tracker copy.
 * 2. "the waiting copy shows while it is thinking" — a stale phrase carried
 *    across a phase change, so the pools crossed.
 * 3. "the model's own line is gone" — narration is streamed, and a projection
 *    only folded committed events (covered by the projection suite; here the
 *    durable half is pinned).
 *
 * These tests read the same tracker the way a projection does: render, throw
 * the instance away, render again.
 * @module @deepseek-ai/dsh-working-activity/tests/status-purity
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLangOverride } from '../src/lang.ts'
import {
  EN_WAITING_PHRASES, EN_THINKING_PHRASES, EN_NIGHT_PHRASES,
  EN_TOOL_OPENING_PHRASES, NIGHT_PHRASES, THINKING_PHRASES, TOOL_OPENING_PHRASES, WAITING_PHRASES,
} from '../src/phrases.ts'
import { ActivityTracker, TRACKER_SNAPSHOT_VERSION, type TrackerConfig } from '../src/status.ts'

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

const CONFIG: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }
/** Ordinary weekday noon: no holiday, no weekend egg. */
const START = new Date('2026-03-16T12:00:00').getTime()
/** The rotation window the tracker promises (the pi cadence, 4 s). */
const WINDOW_MS = 4000

/** A tracker whose state can be read the way a projection reads it. */
function harness(): {
  tracker: ActivityTracker
  /** Render through a throwaway copy, exactly like a projected read. */
  read: (at: number) => string
} {
  const tracker = new ActivityTracker(CONFIG, () => START)
  tracker.onEvent({ kind: 'turn-start', at: START })
  return {
    tracker,
    read: (at: number) => ActivityTracker.restore(CONFIG, () => at, undefined, tracker.snapshot()).render(at).line,
  }
}

describe('a read is a function of the state', () => {
  it('returns the same line however many times it is read', () => {
    const { tracker, read } = harness()
    tracker.onEvent({ kind: 'step-start', at: START + 100 })
    const first = read(START + 2000)
    for (let i = 0; i < 20; i++) {
      expect(read(START + 2000)).toBe(first)
    }
  })

  it('holds one phrase for the whole rotation window', () => {
    const { tracker, read } = harness()
    // The window runs from the phase's own start — here, the first token.
    const anchor = START + 100
    tracker.onEvent({ kind: 'stream-delta', at: anchor, stream: 'reasoning', text: '盘一下' })
    const phrases = new Set<string>()
    for (let at = anchor + 500; at < anchor + WINDOW_MS; at += 500) {
      phrases.add(read(at).replace(/ · .*$/u, ''))
    }
    expect(phrases.size).toBe(1)
  })

  it('changes the phrase once per window, and not faster', () => {
    const { tracker, read } = harness()
    const anchor = START + 100
    tracker.onEvent({ kind: 'stream-delta', at: anchor, stream: 'reasoning', text: '盘一下' })
    const first = read(anchor + 500).replace(/ · .*$/u, '')
    const beforeBoundary = read(anchor + WINDOW_MS - 500).replace(/ · .*$/u, '')
    const afterBoundary = read(anchor + WINDOW_MS + 500).replace(/ · .*$/u, '')
    expect(beforeBoundary).toBe(first)
    expect(afterBoundary).not.toBe(first)
  })

  it('leaves a stable snapshot version for persistent checkpoints', () => {
    // v6: the live-only `firstTokenAt` joined (the overlay promotes a waiting
    // fold to thinking); v5 retired the read-side `reminded` flag.
    expect(TRACKER_SNAPSHOT_VERSION).toBe(6)
  })
})

describe('phase pools never cross', () => {
  const waitingPools = new Set<string>([...WAITING_PHRASES, ...EN_WAITING_PHRASES])
  const thinkingPools = new Set<string>([...THINKING_PHRASES, ...EN_THINKING_PHRASES, ...NIGHT_PHRASES, ...EN_NIGHT_PHRASES])

  it('draws waiting copy while the first token is pending', () => {
    const { tracker, read } = harness()
    // Turn started, no delta yet: the phase is waiting.
    for (let at = START + 500; at < START + 12_000; at += 1000) {
      const phrase = read(at).replace(/ · .*$/u, '')
      expect(waitingPools.has(phrase), `waiting phrase expected, got ${phrase}`).toBe(true)
    }
  })

  it('switches to thinking copy the moment the first token lands', () => {
    const { tracker, read } = harness()
    const before = read(START + 500).replace(/ · .*$/u, '')
    expect(waitingPools.has(before)).toBe(true)

    // The promotion lands mid-turn; the very next read must use the other pool,
    // with no window left over from the waiting phase.
    tracker.onEvent({ kind: 'stream-delta', at: START + 600, stream: 'reasoning', text: '开始想' })
    const after = read(START + 700).replace(/ · .*$/u, '')
    expect(thinkingPools.has(after), `thinking phrase expected, got ${after}`).toBe(true)
    expect(after).not.toBe(before)
  })

  it('keeps the tool phase on the tool line, not on a phrase', () => {
    const { tracker, read } = harness()
    tracker.onEvent({ kind: 'stream-delta', at: START + 100, stream: 'reasoning', text: '跑个命令' })
    tracker.onEvent({ kind: 'tool-start', at: START + 200, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' })
    const line = read(START + 1500)
    const phrase = line.replace(/ · .*$/u, '')
    expect(thinkingPools.has(phrase)).toBe(false)
    expect(waitingPools.has(phrase)).toBe(false)
  })
})

describe('the tool transition stays readable', () => {
  // Real-session measurement behind these two windows: the median tool lasts
  // 87 ms and 73% last under 500 ms — shorter than one client re-read — so a
  // line that only exists while the tool RUNS is a line nobody sees.
  const opening = new Set<string>([...TOOL_OPENING_PHRASES, ...EN_TOOL_OPENING_PHRASES])

  it('opens the turn\'s first tool with the thinking→doing line', () => {
    const { tracker, read } = harness()
    tracker.onEvent({ kind: 'stream-delta', at: START + 100, stream: 'reasoning', text: '看一下' })
    tracker.onEvent({ kind: 'tool-start', at: START + 200, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' })

    const during = read(START + 500)
    expect(opening.has(during.split(' · ')[0] ?? ''), `opening copy expected, got ${during}`).toBe(true)
    // …and it is a prefix: the tool's own copy is still on the line.
    expect(during).toContain('ls')
    // Closed after its window.
    expect(opening.has(read(START + 3200).split(' · ')[0] ?? '')).toBe(false)
  })

  it('does not reopen the line for later tools in the same turn', () => {
    const { tracker, read } = harness()
    tracker.onEvent({ kind: 'stream-delta', at: START + 100, stream: 'reasoning', text: '看一下' })
    tracker.onEvent({ kind: 'tool-start', at: START + 200, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' })
    tracker.onEvent({ kind: 'tool-end', at: START + 400, callId: 'c1', failed: false })
    tracker.onEvent({ kind: 'tool-start', at: START + 6000, callId: 'c2', name: 'read', arguments: '{"file_path":"a.ts"}' })

    const second = read(START + 6200)
    expect(opening.has(second.split(' · ')[0] ?? ''), `no opening for the second tool, got ${second}`).toBe(false)
  })

  it('keeps a settled tool on screen after it ends', () => {
    const { tracker, read } = harness()
    tracker.onEvent({ kind: 'stream-delta', at: START + 100, stream: 'reasoning', text: '看一下' })
    tracker.onEvent({ kind: 'tool-start', at: START + 200, callId: 'c1', name: 'read', arguments: '{"file_path":"src/a.ts"}' })
    tracker.onEvent({ kind: 'tool-end', at: START + 287, callId: 'c1', failed: false })

    const settled = read(START + 800)
    expect(settled.startsWith('✓ '), `settled marker expected, got ${settled}`).toBe(true)
    expect(settled).toContain('src/a.ts')
    expect(settled).toContain('87ms')

    // Past the linger window the line returns to ordinary thinking copy.
    const later = read(START + 4000)
    expect(later.startsWith('✓ ')).toBe(false)
  })
})
