/**
 * Plugin runtime tests: one runtime per session, and no timer for a line that
 * cannot change (issue #14).
 *
 * These drive the real plugin against a stub context and fake timers, so the
 * assertions are about *when* the plugin wakes and for *which* session — the
 * two properties the previous single-`activeSession` + `setInterval` design got
 * wrong: a session that stopped emitting events was never redrawn again, and
 * every session paid for an idle heartbeat.
 * @module @deepseek-ai/dsh-working-activity/tests/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as WorkingActivity from '../src/index.ts'
import { setLangOverride } from '../src/lang.ts'

/** One published snapshot, as the stub session recorded it. */
interface Published {
  readonly type: string
  readonly data: Record<string, unknown>
}

/** A session stand-in that records its appends. */
interface FakeSession {
  readonly session: Session
  readonly published: Published[]
}

function fakeSession(id: string): FakeSession {
  const published: Published[] = []
  const session = {
    id,
    append(type: string, data: Record<string, unknown>) {
      published.push({ type, data })
    },
  } as unknown as Session
  return { session, published }
}

/** The mounted plugin plus the handles a test drives it with. */
interface Harness {
  readonly a: FakeSession
  readonly b: FakeSession
  /** Deliver one session event. */
  readonly event: (session: Session, type: string, data?: Record<string, unknown>) => void
  /** Deliver one event of any subscribed name (e.g. `session/disposed`). */
  readonly fire: (name: string, ...args: unknown[]) => void
  /** Run every effect disposer, as fiber unload does. */
  readonly disposeFiber: () => void
}

/** Mount the plugin on a stub context. */
function mount(): Harness {
  const handlers = new Map<string, (...args: never[]) => void>()
  const disposers: Array<() => void> = []
  const ctx = {
    get: () => undefined,
    inject: () => undefined,
    on: (name: string, handler: (...args: never[]) => void) => {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    },
    effect: (callback: () => unknown) => {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
    },
  } as unknown as Context
  WorkingActivity.apply(ctx, { publish: true, lang: 'zh', tickMs: 500, publishIntervalMs: 0 })

  const a = fakeSession('session-a')
  const b = fakeSession('session-b')
  const fire = (name: string, ...args: unknown[]): void => {
    const handler = handlers.get(name)
    if (handler === undefined) throw new Error(`plugin did not subscribe to ${name}`)
    ;(handler as (...rest: unknown[]) => void)(...args)
  }
  return {
    a,
    b,
    event: (session, type, data = {}) => fire('session/event', session, { type, seq: 0, time: Date.now(), data }),
    fire,
    disposeFiber: () => { for (const dispose of disposers) dispose() },
  }
}

/** Let the plugin's `queueMicrotask` publishes land. */
const flush = (): Promise<void> => Promise.resolve()

beforeEach(() => {
  vi.useFakeTimers()
  setLangOverride('zh')
})
afterEach(() => {
  vi.useRealTimers()
  setLangOverride('auto')
})

describe('per-session runtimes', () => {
  it('keeps redrawing a live session while another session takes the events', async () => {
    const harness = mount()
    harness.event(harness.a.session, 'turn/start', { turn: 1 })
    await flush()
    const afterTurnStart = harness.a.published.length
    expect(afterTurnStart).toBeGreaterThan(0)

    // From here on, ONLY session B receives events.
    harness.event(harness.b.session, 'turn/start', { turn: 1 })
    await flush()
    await vi.advanceTimersByTimeAsync(1200)

    // Session A's line kept moving on its own armed wake-ups; under the old
    // single-active-session design it froze on its last snapshot.
    expect(harness.a.published.length).toBeGreaterThan(afterTurnStart)
    expect(harness.b.published.length).toBeGreaterThan(0)
  })

  it('publishes each session from its own tracker state', async () => {
    const harness = mount()
    harness.event(harness.a.session, 'turn/start', { turn: 1 })
    harness.event(harness.b.session, 'turn/start', { turn: 1 })
    harness.event(harness.b.session, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' })
    await flush()

    expect(harness.a.published.every(entry => entry.type === 'activity/status')).toBe(true)
    expect(harness.b.published.every(entry => entry.type === 'activity/status')).toBe(true)
    expect(harness.a.published.at(-1)?.data.phase).toBe('waiting')
    expect(harness.b.published.at(-1)?.data.phase).toBe('tool')
  })
})

describe('armed wake-ups', () => {
  it('holds no timer once a turn without tools has settled', async () => {
    const harness = mount()
    harness.event(harness.a.session, 'turn/start', { turn: 1 })
    harness.event(harness.a.session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flush()
    // Drain whatever was already armed, then watch a long idle window.
    await vi.advanceTimersByTimeAsync(1000)
    const settled = harness.a.published.length
    expect(harness.a.published.at(-1)?.data.phase).toBe('done')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(harness.a.published.length).toBe(settled)
  })

  it('wakes exactly once to swap a done card from the tool fragment to its summary', async () => {
    const harness = mount()
    const start = Date.now()
    harness.event(harness.a.session, 'turn/start', { turn: 1 })
    harness.event(harness.a.session, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' })
    vi.setSystemTime(start + 1000)
    harness.event(harness.a.session, 'tool/result', {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        id: 'm1',
        source: { kind: 'tool', callId: 'c1' },
        toolCallId: 'c1',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    })
    harness.event(harness.a.session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    const settled = harness.a.published.length

    // The fragment window closes 3 s after the tool ended (at +1000).
    await vi.advanceTimersByTimeAsync(1500)
    expect(harness.a.published.length).toBe(settled)
    await vi.advanceTimersByTimeAsync(600)
    expect(harness.a.published.length).toBe(settled + 1)
    expect(String(harness.a.published.at(-1)?.data.line)).toContain('1 工具')

    // And then nothing more: the summary is static until the next turn.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(harness.a.published.length).toBe(settled + 1)
  })

  it('stops a disposed session from waking again', async () => {
    const harness = mount()
    harness.event(harness.a.session, 'turn/start', { turn: 1 })
    await flush()
    harness.fire('session/disposed', harness.a.session)
    await flush()
    const afterDispose = harness.a.published.length

    await vi.advanceTimersByTimeAsync(5000)
    expect(harness.a.published.length).toBe(afterDispose)
  })

  it('clears every pending wake-up when the fiber unloads', async () => {
    const harness = mount()
    harness.event(harness.a.session, 'turn/start', { turn: 1 })
    harness.event(harness.b.session, 'turn/start', { turn: 1 })
    await flush()
    harness.disposeFiber()
    const a = harness.a.published.length
    const b = harness.b.published.length

    await vi.advanceTimersByTimeAsync(10_000)
    expect(harness.a.published.length).toBe(a)
    expect(harness.b.published.length).toBe(b)
  })
})

describe('live stream frames drive the runtime', () => {
  it('publishes the narration that arrives as a frame', async () => {
    const harness = mount()
    harness.event(harness.a.session, 'turn/start', { turn: 1 })
    harness.fire(
      'agent/assistant-stream',
      { agent: { session: harness.a.session }, frame: { type: 'start', attemptId: 'at-1', revision: 1, turn: 1, step: 1 } },
    )
    harness.fire(
      'agent/assistant-stream',
      {
        agent: { session: harness.a.session },
        frame: {
          type: 'chunk',
          attemptId: 'at-1',
          revision: 2,
          index: 0,
          time: Date.now(),
          chunk: { type: 'text-delta', index: 0, text: '⏵ 修样式' },
        },
      },
    )
    await flush()

    const last = harness.a.published.at(-1)
    expect(last?.data.phase).toBe('thinking')
    expect(String(last?.data.line)).toContain('⏵ 修样式')
  })
})
