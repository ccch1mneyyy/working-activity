/**
 * Narration + token-summary tests: `⏵` self-narration extraction from the
 * stream, freshness window, tool-line prepend, and the done-line token total.
 * @module @deepseek-ai/dsh-working-activity/tests/narration
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ActivityTracker, extractNarration, type TrackerConfig } from '../src/status.ts'
import { setLangOverride } from '../src/lang.ts'

// Deterministic language: the ambient machine may carry DSH_TUI_LANG or a
// persisted ~/.dsh-tui/lang.json. Pin zh for the legacy assertions.
beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

/** Deterministic clock: time advances only when told. */
function fixedClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 2_000_000
  return {
    now: () => current,
    advance: (ms: number) => { current += ms },
  }
}

const LIVE_CONFIG: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }

function eventAt(type: SessionEvent['type'], time: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq: 0, time, data } as SessionEvent
}

function turnStart(time: number): SessionEvent {
  return eventAt('turn/start', time, { turn: 1, trigger: { kind: 'message', source: { kind: 'send' } } })
}

function reasoningDelta(time: number, text: string): SessionEvent {
  return eventAt('assistant/chunk', time, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text } })
}

function toolCall(time: number, callId: string, name: string, args = '{}'): SessionEvent {
  return eventAt('tool/call', time, { turn: 1, step: 1, callId, name, arguments: args })
}

function turnEnd(time: number): SessionEvent {
  return eventAt('turn/end', time, { turn: 1, reason: { kind: 'completed' } })
}

describe('extractNarration', () => {
  it('extracts the latest ⏵ line from a buffer', () => {
    expect(extractNarration('⏵ 查一下报错原因 先看看日志')).toBe('查一下报错原因 先看看日志')
    expect(extractNarration('前面的话 ⏵ 修复登录页样式。')).toBe('修复登录页样式')
    expect(extractNarration('⏵ 第一个\n⏵ 第二个')).toBe('第二个')
  })

  it('keeps a long English narration intact through the newline', () => {
    expect(extractNarration(
      '⏵ Updating the plan-exit test to wait for the final assistant response\nContinuing normally.',
    )).toBe('Updating the plan-exit test to wait for the final assistant response')
  })

  it('stops missing-newline continuation at a sentence boundary', () => {
    expect(extractNarration(
      '⏵ Help-scroll verify crashed on the fork subagent hook; checking whether we can degrade safely.The stub agent.ctx only has `on`, not more reasoning',
    )).toBe('Help-scroll verify crashed on the fork subagent hook; checking whether we can degrade safely')
  })

  it('preserves dotted identifiers and applies semantic limits', () => {
    expect(extractNarration('⏵ Checking ink.tsx and agent.ctx before retrying')).toBe(
      'Checking ink.tsx and agent.ctx before retrying',
    )
    expect(extractNarration(`⏵ ${Array.from({ length: 21 }, (_, i) => `word${i + 1}`).join(' ')}`)).toBe(
      Array.from({ length: 20 }, (_, i) => `word${i + 1}`).join(' '),
    )
    expect(extractNarration('⏵ 一二三四五六七八九十一二三四五六七八九十一继续')).toBe(
      '一二三四五六七八九十一二三四五六七八九十',
    )
  })

  it('returns null without a ⏵ marker', () => {
    expect(extractNarration('没有标记的思考')).toBeNull()
    expect(extractNarration('')).toBeNull()
  })
})

describe('ActivityTracker narration', () => {
  it('shows the ⏵ line while the stream is fresh', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now(), '⏵ 查一下报错原因 先看看日志'))
    clock.advance(1000)
    const state = tracker.render()
    expect(state.phase).toBe('thinking')
    expect(state.line).toContain('⏵ 查一下报错原因')
  })

  it('keeps the latest narration across deltas', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now(), '⏵ 修复登录页样式'))
    clock.advance(3000)
    tracker.onSessionEvent(reasoningDelta(clock.now(), '⏵ 给补丁跑个验证'))
    expect(tracker.render().line).toContain('⏵ 给补丁跑个验证')
  })

  it('falls back to the copy pool once the stream is quiet', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now(), '⏵ 修复登录页样式'))
    clock.advance(6000)
    const line = tracker.render().line
    expect(line).not.toContain('⏵ 修复登录页样式')
    expect(line.length).toBeGreaterThan(0)
  })

  it('prepends narration to the tool line', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now(), '⏵ 跑一下测试'))
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'bash', JSON.stringify({ command: 'npm test' })))
    clock.advance(2000)
    const state = tracker.render()
    expect(state.phase).toBe('tool')
    expect(state.line).toContain('⏵ 跑一下测试')
    expect(state.line).toContain('npm test')
  })
})

describe('ActivityTracker token summary', () => {
  it('appends the turn token total to the done line', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(eventAt('assistant/message', clock.now(), {
      turn: 1, step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'model', provider: 'mock', model: 'm' },
      },
      usage: { inputTokens: 100, outputTokens: 1234, cacheReadTokens: 200 },
    }))
    tracker.onSessionEvent(turnEnd(clock.now()))
    const state = tracker.render()
    expect(state.phase).toBe('done')
    expect(state.line).toContain('🔥 1.5k')
  })
})

describe('ActivityTracker done-line stability', () => {
  it('keeps the completion prefix stable across repeated renders', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'bash', JSON.stringify({ command: 'npm test' })))
    tracker.onSessionEvent(eventAt('tool/result', clock.now(), {
      turn: 1, step: 1,
      message: {
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }], isError: false }],
      },
    }))
    tracker.onSessionEvent(turnEnd(clock.now()))
    const first = tracker.render().line
    // Repeated renders inside the 3s fragment window must not re-roll the
    // randomly drawn completion prefix (a per-render pick would flicker).
    clock.advance(500)
    for (let i = 0; i < 4; i++) {
      expect(tracker.render().line).toBe(first)
      clock.advance(500)
    }
    clock.advance(4000)
    const later = tracker.render().line
    expect(later).not.toBe(first) // fragment window expired -> base line
    const again = tracker.render().line
    expect(again).toBe(later) // base line stays stable too
  })
})

describe('English narration', () => {
  it('shows the ⏵ line with an English elapsed suffix', () => {
    setLangOverride('en')
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now(), '⏵ Inspecting auth'))
    clock.advance(2000)
    const state = tracker.render()
    expect(state.phase).toBe('thinking')
    expect(state.line).toBe('⏵ Inspecting auth · total 2s')
  })
})
