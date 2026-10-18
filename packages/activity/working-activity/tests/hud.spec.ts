/**
 * HUD signals folded from durable RC2/0.1.x events.
 *
 * The line is the only cross-surface display (TUI prompt, WebUI dock, GUI
 * iframe all render the host's `line`), so these cases assert the exact
 * suffixed line rather than a client-side structure.
 * @module @deepseek-ai/dsh-working-activity/tests/hud
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityTracker, type TrackerConfig } from '../src/status.ts'
import { setLangOverride } from '../src/lang.ts'

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

const START = new Date('2026-03-16T12:00:00').getTime()
const CONFIG: TrackerConfig = {
  phrases: true,
  detailLimit: 40,
  showIdle: false,
  hud: true,
  mode: 'lively',
  contextWarnAt: 80,
  contextDangerAt: 95,
}

function tracker(config: TrackerConfig = CONFIG): ActivityTracker {
  const state = new ActivityTracker(config, () => START)
  state.onEvent({ kind: 'turn-start', at: START })
  return state
}

function usage(inputTokens: number, outputTokens = 0) {
  return { inputTokens, outputTokens }
}

describe('context pressure', () => {
  it('shows the provider-anchored percentage once both window and usage exist', () => {
    const state = tracker()
    state.onEvent({ kind: 'context-window', at: START, window: 100_000 })
    state.onEvent({ kind: 'assistant-settled', at: START + 100, usage: usage(62_000, 100) })
    expect(state.render(START + 100).line).toContain('ctx 62%')
  })

  it('uses a stronger marker at the danger threshold', () => {
    const state = tracker({ ...CONFIG, contextWarnAt: 50, contextDangerAt: 60 })
    state.onEvent({ kind: 'context-window', at: START, window: 100_000 })
    state.onEvent({ kind: 'assistant-settled', at: START + 100, usage: usage(62_000) })
    expect(state.render(START + 100).line).toContain('ctx 62% ⛔')
  })

  it('marks a reading at or above the warning threshold', () => {
    const state = tracker({ ...CONFIG, contextWarnAt: 50 })
    state.onEvent({ kind: 'context-window', at: START, window: 100_000 })
    state.onEvent({ kind: 'assistant-settled', at: START + 100, usage: usage(62_000) })
    expect(state.render(START + 100).line).toContain('ctx 62% ⚠')
  })

  it('hides the stale sample after a compaction until the next usage', () => {
    const state = tracker()
    state.onEvent({ kind: 'context-window', at: START, window: 100_000 })
    state.onEvent({ kind: 'assistant-settled', at: START + 100, usage: usage(62_000) })
    state.onEvent({ kind: 'compaction', at: START + 200 })
    expect(state.render(START + 200).line).not.toContain('ctx ')
  })
})

describe('workload badges', () => {
  it('shows todo progress from the whole-list snapshot', () => {
    const state = tracker()
    state.onEvent({ kind: 'todo-write', at: START + 100, counts: { done: 2, total: 5, inProgress: 1 } })
    expect(state.render(START + 100).line).toContain('2/5 待办')
  })

  it('shows running background jobs and drops them when settled', () => {
    const state = tracker()
    state.onEvent({
      kind: 'job-start', at: START + 100,
      job: { id: 'j1', kind: 'bash', label: 'npm test', startedAt: START + 100 },
    })
    expect(state.render(START + 100).line).toContain('1 任务')
    state.onEvent({ kind: 'job-end', at: START + 200, jobId: 'j1' })
    expect(state.render(START + 200).line).not.toContain('任务')
  })

  it('prefers an active Agent Team over the raw child count', () => {
    const state = tracker()
    state.onEvent({ kind: 'subagent-catalog', at: START + 100, subagent: { id: 's1', mode: 'one-shot' } })
    state.onEvent({
      kind: 'team-member', at: START + 110,
      member: { id: 'm1', name: 'worker', phase: 'active' },
    })
    const line = state.render(START + 110).line
    expect(line).toContain('1 团队')
    expect(line).not.toContain('子代理')
  })

  it('shows goal rounds and plan mode', () => {
    const state = tracker()
    state.onEvent({
      kind: 'goal-change', at: START + 100,
      goal: { phase: 'active', rounds: 2, maxRounds: 10 },
    })
    state.onEvent({ kind: 'plan-mode', at: START + 110, plan: { active: true } })
    const line = state.render(START + 110).line
    expect(line).toContain('目标 2/10')
    expect(line).toContain('计划')
  })

  it('appends the turn token total at done', () => {
    const state = tracker()
    state.onEvent({ kind: 'assistant-settled', at: START + 100, usage: usage(1_000, 500) })
    state.onEvent({ kind: 'turn-end', at: START + 200 })
    expect(state.render(START + 200).line).toContain('1.5k tok')
  })
})

describe('HUD feature gates', () => {
  it('hides every badge when hud is off', () => {
    const state = tracker({ ...CONFIG, hud: false })
    state.onEvent({ kind: 'context-window', at: START, window: 100_000 })
    state.onEvent({ kind: 'assistant-settled', at: START + 100, usage: usage(62_000) })
    state.onEvent({ kind: 'todo-write', at: START + 110, counts: { done: 1, total: 2, inProgress: 0 } })
    const line = state.render(START + 110).line
    expect(line).not.toContain('ctx ')
    expect(line).not.toContain('待办')
  })

  it('keeps context pressure in minimal mode but drops the verbose badges', () => {
    const state = tracker({ ...CONFIG, mode: 'minimal' })
    state.onEvent({ kind: 'context-window', at: START, window: 100_000 })
    state.onEvent({ kind: 'assistant-settled', at: START + 100, usage: usage(62_000) })
    state.onEvent({ kind: 'todo-write', at: START + 110, counts: { done: 1, total: 2, inProgress: 0 } })
    const line = state.render(START + 110).line
    expect(line).toContain('ctx 62%')
    expect(line).not.toContain('待办')
  })

  it('honours an explicit feature switch over the mode default', () => {
    const state = tracker({ ...CONFIG, mode: 'minimal', features: { todos: true } })
    state.onEvent({ kind: 'todo-write', at: START + 100, counts: { done: 1, total: 2, inProgress: 0 } })
    expect(state.render(START + 100).line).toContain('1/2 待办')
  })
})

describe('concurrent tool anchor', () => {
  it('exposes the oldest active tool as the tick anchor', () => {
    const state = tracker()
    state.onEvent({ kind: 'tool-start', at: START, callId: 'a', name: 'bash', arguments: '{"command":"sleep 10"}' })
    state.onEvent({ kind: 'tool-start', at: START + 5_000, callId: 'b', name: 'bash', arguments: '{"command":"echo b"}' })
    expect(state.render(START + 10_000).toolStartedAt).toBe(START)
  })
})

describe('HUD persistence', () => {
  it('round-trips every badge through the projection checkpoint shape', () => {
    const state = tracker()
    state.onEvent({ kind: 'context-window', at: START, window: 100_000 })
    state.onEvent({ kind: 'assistant-settled', at: START + 100, usage: usage(62_000) })
    state.onEvent({ kind: 'todo-write', at: START + 110, counts: { done: 2, total: 5, inProgress: 1 } })
    state.onEvent({ kind: 'job-start', at: START + 120, job: { id: 'j1', kind: 'bash', label: 'x', startedAt: START } })
    state.onEvent({ kind: 'subagent-catalog', at: START + 130, subagent: { id: 's1', mode: 'one-shot' } })
    state.onEvent({ kind: 'team-member', at: START + 140, member: { id: 'm1', name: 'a', phase: 'active' } })
    state.onEvent({ kind: 'goal-change', at: START + 150, goal: { phase: 'active', rounds: 2, maxRounds: 10 } })
    state.onEvent({ kind: 'plan-mode', at: START + 160, plan: { active: true } })
    const restored = ActivityTracker.restore(CONFIG, () => START + 200, undefined, state.snapshot())
    expect(restored.render(START + 200).line).toBe(state.render(START + 200).line)
  })
})

describe('queued input', () => {
  it('shows and clears the queued-message count', () => {
    const state = tracker()
    state.onEvent({ kind: 'queue-change', at: START + 100, target: 'next-turn', delta: 2 })
    expect(state.render(START + 100).line).toContain('+2 排队')
    state.onEvent({ kind: 'queue-change', at: START + 200, target: 'next-turn', delta: -2 })
    expect(state.render(START + 200).line).not.toContain('+2 排队')
  })
})
