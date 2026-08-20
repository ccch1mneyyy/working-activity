/**
 * ActivityTracker state-machine tests: event sequences drive phases, lines,
 * elapsed accounting, and the done summary.
 * @module @deepseek-ai/dsh-working-activity/tests/status
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ActivityTracker, type TrackerConfig } from '../src/status.ts'
import * as phrases from '../src/phrases.ts'
import { setLangOverride } from '../src/lang.ts'

// Deterministic language: the ambient machine may carry DSH_TUI_LANG or a
// persisted ~/.dsh-tui/lang.json (the user's own prefs). Pin zh for the
// legacy assertions and reset after.
beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

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

describe('ActivityTracker English mode', () => {
  it('renders plain functional labels in English', () => {
    setLangOverride('en')
    const clock = fixedClock()
    const tracker = new ActivityTracker(MINIMAL_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    clock.advance(1000)
    expect(tracker.render().line).toBe('Waiting for model · total 1s')
    tracker.onSessionEvent(reasoningDelta(clock.now()))
    expect(tracker.render().line).toBe('Thinking · total 1s')
  })

  it('renders playful English thinking lines without Han', () => {
    setLangOverride('en')
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now()))
    clock.advance(5000)
    const state = tracker.render()
    expect(state.phase).toBe('thinking')
    expect(state.line).toContain('total 5s')
    expect(state.line).not.toMatch(/\p{Script=Han}/u)
  })

  it('renders an English done summary with tool split', () => {
    setLangOverride('en')
    const clock = fixedClock()
    const tracker = new ActivityTracker(LIVE_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    clock.advance(2000)
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'edit', JSON.stringify({ file: 'src/index.ts' })))
    clock.advance(4000)
    tracker.onSessionEvent(toolResult(clock.now(), 'c1'))
    clock.advance(1000)
    tracker.onSessionEvent(turnEnd(clock.now()))
    // Expire the done-fragment window so the summary branch renders.
    clock.advance(4000)
    const state = tracker.render()
    expect(state.phase).toBe('done')
    expect(state.line).not.toMatch(/\p{Script=Han}/u)
    expect(state.line).toMatch(/1 tool/)
    expect(state.line).toMatch(/thought \d+s worked \d+s/)
  })

  it('keeps the zh line when the language flips back', () => {
    setLangOverride('en')
    const clock = fixedClock()
    const tracker = new ActivityTracker(MINIMAL_CONFIG, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    clock.advance(1000)
    expect(tracker.render().line).toContain('Waiting for model')
    setLangOverride('zh')
    expect(tracker.render().line).toBe('等待模型响应 · 总1s')
  })
})

describe('ActivityTracker easter eggs', () => {
  const NEW_YEAR_POOL = phrases.HOLIDAY_PHRASES['01-01'] as readonly string[]

  /** Clock pinned to a holiday noon (2026-01-01, Thursday, 12:00). */
  function holidayClock(): { now: () => number; advance: (ms: number) => void } {
    let current = new Date('2026-01-01T12:00:00').getTime()
    return {
      now: () => current,
      advance: (ms: number) => { current += ms },
    }
  }

  /** Clock pinned to an ordinary weekday noon (2026-03-16, Monday). */
  function mondayClock(): { now: () => number; advance: (ms: number) => void } {
    let current = new Date('2026-03-16T12:00:00').getTime()
    return {
      now: () => current,
      advance: (ms: number) => { current += ms },
    }
  }

  const EGG_FREE_CONFIG: TrackerConfig = {
    phrases: true, detailLimit: 40, showIdle: false,
    features: { rareEggs: false, weekend: false, holidays: false },
  }

  it('shows a holiday phrase once per turn, then normal copy', () => {
    const clock = holidayClock()
    const tracker = new ActivityTracker({
      phrases: true, detailLimit: 40, showIdle: false,
      features: { rareEggs: false, weekend: false },
    }, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now()))
    const first = tracker.render()
    expect(NEW_YEAR_POOL).toContain(first.phrase)

    // Next rotation (> PHRASE_ROTATE_MS) draws normal copy, not the holiday.
    clock.advance(10_000)
    const second = tracker.render()
    expect(NEW_YEAR_POOL).not.toContain(second.phrase)

    // A new turn can roll the egg again (advance past the rotation window).
    clock.advance(1000)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now()))
    clock.advance(5000)
    expect(NEW_YEAR_POOL).toContain(tracker.render().phrase)
  })

  it('skips holiday copy when the feature is off', () => {
    const clock = holidayClock()
    const tracker = new ActivityTracker({
      ...EGG_FREE_CONFIG, features: { ...EGG_FREE_CONFIG.features, holidays: true },
    }, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now()))
    expect(NEW_YEAR_POOL).toContain(tracker.render().phrase)
    const off = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    off.onSessionEvent(turnStart(clock.now()))
    off.onSessionEvent(reasoningDelta(clock.now()))
    expect(NEW_YEAR_POOL).not.toContain(off.render().phrase)
  })

  it('merges custom phrases into thinking copy', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker({
      ...EGG_FREE_CONFIG, customPhrases: ['自定义一条'],
    }, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now()))
    const seen = new Set<string>()
    for (let i = 0; i < 800; i++) {
      clock.advance(5000)
      const phrase = tracker.render().phrase
      if (phrase !== undefined) seen.add(phrase)
    }
    expect(seen).toContain('自定义一条')
  })
})

describe('ActivityTracker one-off quips and live extras', () => {
  /** Clock pinned to an ordinary weekday noon (2026-03-16, Monday). */
  function mondayClock(): { now: () => number; advance: (ms: number) => void } {
    let current = new Date('2026-03-16T12:00:00').getTime()
    return {
      now: () => current,
      advance: (ms: number) => { current += ms },
    }
  }

  const EGG_FREE_CONFIG: TrackerConfig = {
    phrases: true, detailLimit: 40, showIdle: false,
    features: { rareEggs: false, weekend: false, holidays: false },
  }

  /** Drive a tracker to the thinking phase at the current clock time. */
  function startThinking(tracker: ActivityTracker, clock: { now: () => number }): void {
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(reasoningDelta(clock.now()))
  }

  it('shows the interrupt quip once, then normal copy', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    startThinking(tracker, clock)
    tracker.onInterrupted()
    const quip = tracker.render()
    expect(phrases.CONTINUE_PHRASES).toContain(quip.phrase)

    // Expired → normal copy on the next rotation.
    clock.advance(10_000)
    expect(phrases.CONTINUE_PHRASES).not.toContain(tracker.render().phrase)
  })

  it('shows the model-switch quip for a known model id', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    startThinking(tracker, clock)
    tracker.onModelSwitch('deepseek-chat')
    expect(phrases.MODEL_QUIPS.deepseek).toContain(tracker.render().phrase)
  })

  it('ignores unknown model ids', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    startThinking(tracker, clock)
    const before = tracker.render().phrase
    tracker.onModelSwitch('no-such-model-xyz')
    expect(tracker.render().phrase).toBe(before)
  })

  it('shows the compaction quip', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    startThinking(tracker, clock)
    tracker.onCompact('done')
    expect(phrases.COMPACT_PHRASES).toContain(tracker.render().phrase)
    tracker.onCompact('overflow')
    expect(phrases.OVERFLOW_PHRASES).toContain(tracker.render().phrase)
  })

  it('shows the git branch on git tools when fed', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    startThinking(tracker, clock)
    tracker.onGitBranch('main')
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'git', '{}'))
    expect(tracker.render().line).toContain('git main')
  })

  it('shows the combo badge on consecutive fast tools', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    startThinking(tracker, clock)
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'bash', '{}'))
    clock.advance(1000)
    tracker.onSessionEvent(toolResult(clock.now(), 'c1'))
    clock.advance(1000)
    tracker.onSessionEvent(toolCall(clock.now(), 'c2', 'grep', '{}'))
    expect(tracker.render().line).toContain('工具x2')
  })

  it('counts subagents in the done summary', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    startThinking(tracker, clock)
    tracker.onSessionEvent(toolCall(clock.now(), 'c1', 'subagent', '{}'))
    clock.advance(1000)
    tracker.onSessionEvent(toolResult(clock.now(), 'c1'))
    clock.advance(1000)
    tracker.onSessionEvent(turnEnd(clock.now()))
    clock.advance(5000)
    expect(tracker.render().line).toContain('子代理 1 个')
  })

  it('shows an estimated tps prefix while streaming', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker({ ...EGG_FREE_CONFIG, showTokPerSec: true }, clock.now)
    tracker.onSessionEvent(turnStart(clock.now()))
    tracker.onSessionEvent(eventAt('assistant/chunk', clock.now(), {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '中文中文中文' },
    }))
    expect(tracker.render().line).toMatch(/~?\d+ tok\/s/)
  })

  it('fires the work reminder once after the threshold hours', () => {
    const clock = mondayClock()
    const tracker = new ActivityTracker({ ...EGG_FREE_CONFIG, workRemindAt: 1 }, clock.now)
    startThinking(tracker, clock)
    clock.advance(3_700_000) // > 1h
    const reminded = tracker.render()
    expect(reminded.phrase).toMatch(/小时|hour/)
    clock.advance(10_000)
    expect(tracker.render().phrase).not.toMatch(/小时|hour/)
  })

  it('keeps the thinking line stable (no ellipsis breathing)', () => {
    // The indicator animation already signals activity, so the pi DOT_FRAMES
    // breathing was removed — the line must not change between ticks.
    const clock = mondayClock()
    const tracker = new ActivityTracker(EGG_FREE_CONFIG, clock.now)
    startThinking(tracker, clock)
    const first = tracker.render().line
    clock.advance(500)
    const second = tracker.render().line
    expect(first).toBe(second)
    expect(second).not.toMatch(/ ·{1,3} · 总| ·{1,3}$/)
  })
})
