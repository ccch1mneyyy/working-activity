/**
 * Task-level elapsed time.
 *
 * A task spans user interjections. The durable boundary is the inbox: a
 * next-turn message queued while a turn is running keeps the task open across
 * the turn break; a turn that ends with an empty queue closes it. This suite
 * pins the continuation, the new-task reset, and the task-level done summary.
 * @module @deepseek-ai/dsh-working-activity/tests/task-timer
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityTracker } from '../src/status.ts'
import { setLangOverride } from '../src/lang.ts'

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

const START = 1_700_000_000_000
const CONFIG = { phrases: false, detailLimit: 40, showIdle: false }

function tracker(): { state: ActivityTracker; tick: (ms: number) => void; now: () => number } {
  let now = START
  return {
    state: new ActivityTracker(CONFIG, () => now),
    tick: (ms: number) => { now += ms },
    now: () => now,
  }
}

describe('task elapsed', () => {
  it('counts one turn as the task', () => {
    const { tick, now, state } = tracker()
    state.onEvent({ kind: 'turn-start', at: now() })
    tick(2_000)
    state.onEvent({ kind: 'turn-end', at: now() })
    const rendered = state.render(now())
    expect(rendered.taskStartedAt).toBe(START)
    expect(rendered.taskElapsedMs).toBe(2_000)
    expect(rendered.line).toContain('总2s')
  })

  it('keeps the task across a turn queued by an interjection', () => {
    const { tick, now, state } = tracker()
    state.onEvent({ kind: 'turn-start', at: now() })
    tick(1_000)
    // The user interjected while the first turn was running.
    state.onEvent({ kind: 'queue-change', at: now(), target: 'next-turn', delta: 1 })
    tick(1_000)
    state.onEvent({ kind: 'turn-end', at: now() })
    expect(state.render(now()).taskElapsedMs).toBe(2_000)

    tick(5_000)
    state.onEvent({ kind: 'turn-start', at: now() })
    state.onEvent({ kind: 'queue-change', at: now(), target: 'next-turn', delta: -1 })
    tick(2_000)
    state.onEvent({ kind: 'turn-end', at: now() })
    const rendered = state.render(now())
    expect(rendered.taskStartedAt).toBe(START)
    expect(rendered.taskElapsedMs).toBe(9_000)
    expect(rendered.line).toContain('总9s')
  })

  it('starts a new task after an idle turn', () => {
    const { tick, now, state } = tracker()
    state.onEvent({ kind: 'turn-start', at: now() })
    tick(1_000)
    state.onEvent({ kind: 'turn-end', at: now() })
    tick(5_000)
    state.onEvent({ kind: 'turn-start', at: now() })
    expect(state.render(now()).taskStartedAt).toBe(START + 6_000)
    expect(state.render(now()).taskElapsedMs).toBe(0)
  })

  it('aggregates tool and token totals across the task', () => {
    const { tick, now, state } = tracker()
    state.onEvent({ kind: 'turn-start', at: now() })
    state.onEvent({ kind: 'tool-start', at: now(), callId: 'a', name: 'bash', arguments: '{"command":"ls"}' })
    tick(1_000)
    state.onEvent({ kind: 'tool-end', at: now(), callId: 'a', failed: false })
    state.onEvent({ kind: 'queue-change', at: now(), target: 'next-turn', delta: 1 })
    state.onEvent({ kind: 'turn-end', at: now() })

    tick(2_000)
    state.onEvent({ kind: 'turn-start', at: now() })
    state.onEvent({ kind: 'queue-change', at: now(), target: 'next-turn', delta: -1 })
    state.onEvent({ kind: 'tool-start', at: now(), callId: 'b', name: 'bash', arguments: '{"command":"pwd"}' })
    tick(1_000)
    state.onEvent({ kind: 'tool-end', at: now(), callId: 'b', failed: false })
    state.onEvent({ kind: 'assistant-settled', at: now(), usage: { inputTokens: 100, outputTokens: 50 } })
    state.onEvent({ kind: 'turn-end', at: now() })

    const line = state.render(now()).line
    expect(line).toContain('2 工具')
    expect(line).toContain('🔥 150')
    expect(line).toContain('总4s')
  })
})
