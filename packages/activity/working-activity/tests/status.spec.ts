/**
 * ActivityTracker state-machine tests: event sequences drive phases, lines,
 * elapsed accounting, and the done summary.
 * @module @deepseek-ai/dsh-working-activity/tests/status
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ActivityTracker, type TrackerConfig } from '../src/status.ts'

/** Deterministic clock: time advances only when told. */
function fixedClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 1_000_000
  return {
    now: () => current,
    advance: (ms: number) => { current += ms },
  }
}

const LIVE_CONFIG: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }
const MINIMAL_CONFIG: TrackerConfig = { phrases: false, detailLimit: 40, showIdle: false }

/** Build a session event with a chosen timestamp. */
function eventAt(type: SessionEvent['type'], time: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq: 0, time, data } as SessionEvent
}

function turnStart(time: number): SessionEvent {
  return eventAt('turn/start', time, { turn: 1, trigger: { kind: 'message', source: { kind: 'send' } } })
}

function reasoningDelta(time: number): SessionEvent {
  return eventAt('assistant/chunk', time, {
    turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '嗯' },
  })
}

function toolCall(time: number, callId: string, name: string, args = '{}'): SessionEvent {
  return eventAt('tool/call', time, { turn: 1, step: 1, callId, name, arguments: args })
}

function toolResult(time: number, callId: string, isError = false): SessionEvent {
  return eventAt('tool/result', time, {
    turn: 1, step: 1,
    message: {
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'ok' }], isError }],
    },
  })
}

function turnEnd(time: number): SessionEvent {
  return eventAt('turn/end', time, { turn: 1, reason: { kind: 'completed' } })
}

describe('ActivityTracker idle and waiting', () => {
  it('renders an empty idle line before any activity', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    const state = tracker.render()
    expect(state.phase).toBe('idle')
    expect(state.line).toBe('')
    expect(state.toolCount).toBe(0)
  })

  it('enters waiting on agent running and turn start', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onAgentStatus('running')
    tracker.onSessionEvent(turnStart(clock.now()))
    clock.advance(1000)
    const state = tracker.render()
    expect(state.phase).toBe('waiting')
    expect(state.line).toContain('总1s')
  })

  it('moves to thinking on the first streamed reasoning delta', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now()))
    clock.advance(5000)
    const state = tracker.render()
    expect(state.phase).toBe('thinking')
    expect(state.line).toContain('总5s')
  })
})

describe('ActivityTracker tool phases', () => {
  it('shows the playful action, detail, and tool elapsed while a tool runs', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'bash', JSON.stringify({ command: 'npm test' })))
    clock.advance(12_000)
    const state = tracker.render()
    expect(state.phase).toBe('tool')
    // The action verb is drawn at random from the bash pool; the detail and
    // elapsed time are deterministic.
    expect(state.line).toContain('npm test')
    expect(state.line).toContain('12s')
    expect(state.label).toBeDefined()
    expect(state.detail).toBe('npm test')
  })

  it('truncates long details to the configured limit', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker({ ...LIVE_CONFIG, detailLimit: 10 }, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'read', JSON.stringify({ file_path: 'a/very/long/path/that/keeps/going.md' })))
    const state = tracker.render()
    expect(state.phase).toBe('tool')
    expect(state.detail!.length).toBeLessThanOrEqual(10)
    expect(state.detail).toContain('…')
  })

  it('returns to thinking with accumulated tool time after a result', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'bash', JSON.stringify({ command: 'npm test' })))
    clock.advance(3000)
    tracker.onSessionEvent(toolResult(clock.now(), 'c1'))
    clock.advance(2000)
    const state = tracker.render()
    expect(state.phase).toBe('thinking')
    expect(tracker.stats()).toMatchObject({ toolCount: 1, toolMs: 3000 })
  })

  it('flags a failed tool in the done line', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'read', JSON.stringify({ file_path: 'config.json' })))
    tracker.onSessionEvent(toolResult(clock.now(), 'c1', true))
    tracker.onSessionEvent(turnEnd(clock.now()))
    const state = tracker.render()
    expect(state.phase).toBe('done')
    // The failure prefix draws from the FAIL_PHRASES pool; assert the
    // failure semantics (not a success line) plus the tool fragment.
    expect(state.line).not.toContain('搞定')
    expect(state.line).toContain('config.json')
  })

  it('renders a summary at turn end with thinking/tool split', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    clock.advance(2000)
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'edit', JSON.stringify({ file: 'src/index.ts' })))
    clock.advance(4000)
    tracker.onSessionEvent(toolResult(clock.now(), 'c1'))
    clock.advance(1000)
    tracker.onSessionEvent(turnEnd(clock.now()))
    const state = tracker.render()
    expect(state.phase).toBe('done')
    expect(state.line).toContain('1 工具')
    expect(tracker.stats()).toMatchObject({ toolCount: 1, toolMs: 4000, thinkingMs: 3000 })
  })

  it('stays in the done phase after agent idle, then reports stats', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(turnEnd(clock.now()))
    tracker.onAgentStatus('idle')
    expect(tracker.render().phase).toBe('done')
  })
})

describe('ActivityTracker minimal mode', () => {
  it('renders plain functional labels without copy pools', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(MINIMAL_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    clock.advance(1000)
    expect(tracker.render().line).toBe('等待模型响应 · 总1s')
    tracker.onSessionEvent(reasoningDelta(clock.now()))
    expect(tracker.render().line).toBe('思考中 · 总1s')
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'bash', JSON.stringify({ command: 'npm test' })))
    expect(tracker.render().line).toContain('bash npm test')
  })
})

describe('ActivityTracker custom actions', () => {
  it('prefers the exact-name custom action pool', () => {
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now, { my_deploy: ['部署一下', '上线中'] })
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'my_deploy', '{}'))
    const state = tracker.render()
    expect(state.phase).toBe('tool')
    expect(['部署一下', '上线中']).toContain(state.label)
  })
})
