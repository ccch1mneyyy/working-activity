/**
 * `workingActivity` projection tests (the Web transport).
 *
 * The projection is the only path by which a browser sees the line, so these
 * cases pin the three things the host contract cares about — the shape a client
 * reads, the same-reference rule for unmodeled events, and the dual-spelling
 * definition that has to register on both supported host corridors.
 * @module @deepseek-ai/dsh-working-activity/tests/projection
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLangOverride } from '../src/lang.ts'
import {
  ACTIVITY_PROJECTION_KEY,
  ACTIVITY_PROJECTION_STATE_VERSION,
  createActivityProjection,
  type WorkingActivityView,
} from '../src/projection.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ActivityTracker, type TrackerConfig } from '../src/status.ts'
import {
  THINKING_PHRASES, WAITING_PHRASES, EN_THINKING_PHRASES, EN_WAITING_PHRASES,
  THINKING_TIERS, EN_THINKING_TIERS,
} from '../src/phrases.ts'

const CONFIG: TrackerConfig = { phrases: true, detailLimit: 40, showIdle: false }
const START = new Date('2026-03-16T12:00:00').getTime()

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

/** A projection on a clock the test drives. */
function build(start = START): {
  projection: ReturnType<typeof createActivityProjection>
  tick: (ms: number) => void
  at: () => number
} {
  let current = start
  const projection = createActivityProjection({
    trackerConfig: CONFIG,
    now: () => current,
    lang: () => 'zh',
  })
  return { projection, tick: (ms: number) => { current += ms }, at: () => current }
}

/** A durable session event with a chosen timestamp. */
function event(type: string, time: number, data: Record<string, unknown> = {}): SessionEvent {
  return { type, seq: 0, time, data } as unknown as SessionEvent
}

describe('narration through the projection', () => {  /** A settled assistant message whose text opens with the `⏵` line. */
  function narratedTurn(at: number): SessionEvent {
    return event('assistant/message', at, {
      usage: { inputTokens: 10, outputTokens: 5 },
      message: {
        role: 'assistant',
        id: 'm1',
        content: [{ type: 'text', text: '⏵ 正在修登录页样式。\n\n完事。' }],
      },
    })
  }

  it('recovers the model line from a settled message', () => {
    // Live narration arrives on stream frames, which a projection never sees;
    // the settled message is the durable half, so a replayed log (or a client
    // that missed the frames) still gets the model's own words.
    const { projection, at } = build()
    let state = projection.apply(projection.init(), event('turn/start', START, { turn: 1 }))
    state = projection.apply(state, narratedTurn(START + 500))

    const view = projection.view(state) as WorkingActivityView
    expect(view.line).toContain('⏵ 正在修登录页样式')
    expect(view.phrase).toBe('正在修登录页样式')
  })

  it('overlays the live narration a host supplies', () => {
    // The host that owns the frames hands the freshest line over per read; the
    // value keeps everything else from the log.
    let current = START
    const live = { narration: '跑一下测试', lastChunkAt: START + 1000 }
    const projection = createActivityProjection({
      trackerConfig: CONFIG,
      now: () => current,
      lang: () => 'zh',
      live: () => live,
    })
    let state = projection.apply(projection.init(), event('turn/start', START, { turn: 1 }))
    state = projection.apply(state, event('step/start', START + 100, { turn: 1, step: 1 }))
    current = START + 1200

    const view = projection.view(state) as WorkingActivityView
    expect(view.line).toContain('⏵ 跑一下测试')
    // Past the narration grace window the overlay stops showing, with no state
    // change: the live payload's own clock decides.
    current = START + 20_000
    expect((projection.view(state) as WorkingActivityView).line).not.toContain('跑一下测试')
  })
})

describe('projection definition shape', () => {
  it('carries every host contract spelling', () => {
    const { projection } = build()
    // Three corridors, three spellings: 0.1.7-rc.2 reads `stateSchema` + `wire`;
    // 0.1.2-alpha.2 reads `stateSchema` + top-level `viewSchema` + `view`; the
    // rc.6-era contract reads `schema` + `view`. One definition satisfies all.
    expect(projection.key).toBe(ACTIVITY_PROJECTION_KEY)
    expect(projection.stateVersion).toBe(ACTIVITY_PROJECTION_STATE_VERSION)
    expect(typeof projection.init).toBe('function')
    expect(typeof projection.apply).toBe('function')
    expect(projection.stateSchema).toBeDefined()
    expect(projection.wire.viewSchema).toBeDefined()
    expect(projection.schema).toBeDefined()
    expect(projection.viewSchema).toBeDefined()
    expect(projection.view).toBe(projection.wire.view)
    // All three schema spellings describe the same payload.
    expect(projection.schema).toBe(projection.wire.viewSchema)
    expect(projection.viewSchema).toBe(projection.wire.viewSchema)
  })

  it('validates its own wire value', () => {
    const { projection } = build()
    const state = projection.init()
    expect(() => projection.wire.viewSchema.parse(projection.view(state))).not.toThrow()
    // A value the schema would reject must fail loudly rather than reach a client.
    expect(() => projection.wire.viewSchema.parse({ phase: 'nonsense' })).toThrow()
  })

  it('validates the fold state it persists', () => {
    const { projection } = build()
    expect(() => projection.stateSchema.parse(projection.init())).not.toThrow()
    expect(() => projection.stateSchema.parse({ tracker: {}, updatedAt: 'later' })).toThrow()
  })
})

describe('projection folding', () => {
  it('starts idle and renders nothing', () => {
    const { projection } = build()
    const view = projection.view(projection.init()) as WorkingActivityView
    expect(view.phase).toBe('idle')
    expect(view.line).toBe('')
    expect(view.live).toBe(false)
    expect(view.lang).toBe('zh')
    expect(view.updatedAt).toBe(0)
  })

  it('follows a turn from waiting through a tool to its count', () => {
    const { projection, tick, at } = build()
    let state = projection.init()

    state = projection.apply(state, event('turn/start', START, { turn: 1 }))
    let view = projection.view(state) as WorkingActivityView
    expect(view.phase).toBe('waiting')
    expect(view.live).toBe(true)
    expect(view.updatedAt).toBe(START)
    expect(view.turnStartedAt).toBe(START)

    tick(1500)
    state = projection.apply(state, event('tool/call', at(), {
      turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"npm test"}',
    }))
    view = projection.view(state) as WorkingActivityView
    expect(view.phase).toBe('tool')
    expect(view.label).toBeDefined()
    expect(view.detail).toBe('npm test')
    // A live tool phase counts its own elapsed, so a client needs the instant.
    expect(view.phaseStartedAt).toBe(at())

    tick(2000)
    state = projection.apply(state, event('tool/result', at(), {
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
    }))
    view = projection.view(state) as WorkingActivityView
    expect(view.phase).toBe('thinking')
    expect(view.toolCount).toBe(1)
  })

  it('returns the same state reference for an event it does not model', () => {
    const { projection, at } = build()
    const state = projection.apply(projection.init(), event('turn/start', START, { turn: 1 }))
    // The host treats an unchanged reference as "zero downstream work"; a
    // rebuilt state on every durable event would broadcast for nothing.
    expect(projection.apply(state, event('step/end', at(), { turn: 1, step: 1 }))).toBe(state)
    expect(projection.apply(state, event('some/unmodelled', at(), {}))).toBe(state)
  })

  it('carries the language through to the client', () => {
    let current = START
    const projection = createActivityProjection({
      trackerConfig: CONFIG,
      now: () => current,
      lang: () => 'en',
    })
    const state = projection.apply(projection.init(), event('turn/start', current, { turn: 1 }))
    current += 10
    expect((projection.view(state) as WorkingActivityView).lang).toBe('en')
  })

  it('survives a persisted checkpoint round trip', () => {
    const { projection, tick, at } = build()
    let state = projection.apply(projection.init(), event('turn/start', START, { turn: 1 }))
    tick(1000)
    state = projection.apply(state, event('tool/call', at(), {
      turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"a.ts"}',
    }))
    const before = projection.view(state) as WorkingActivityView

    // Exactly what the host persists and hands back: plain JSON.
    const checkpoint = JSON.parse(JSON.stringify(state)) as unknown
    const resumed = projection.view(checkpoint) as WorkingActivityView
    expect(resumed.phase).toBe(before.phase)
    expect(resumed.line).toBe(before.line)
    expect(resumed.toolCount).toBe(before.toolCount)
    expect(resumed.phaseStartedAt).toBe(before.phaseStartedAt)

    // And it keeps folding from there.
    tick(500)
    const next = projection.apply(checkpoint, event('tool/result', at(), {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        id: 'm2',
        source: { kind: 'tool', callId: 'c1' },
        toolCallId: 'c1',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    }))
    expect((projection.view(next) as WorkingActivityView).toolCount).toBe(1)
  })
})

describe('unusable checkpoints degrade, never throw', () => {
  /**
   * A checkpoint with ONE field corrupted, built from a real snapshot so the
   * rest of the shape is exactly what a healthy fold emits — each case feeds
   * the one guard that must refuse it (a torn write can corrupt any single
   * field while leaving the others intact).
   */
  function corrupted(mutate: (tracker: Record<string, unknown>) => void): unknown {
    const tracker = new ActivityTracker(CONFIG, () => START)
    tracker.onEvent({ kind: 'turn-start', at: START })
    // Wrap the tracker snapshot exactly the way a persisted state carries it.
    const payload = {
      tracker: JSON.parse(JSON.stringify(tracker.snapshot())) as Record<string, unknown>,
      updatedAt: START,
    }
    mutate(payload.tracker)
    return payload
  }

  it('falls back to a fresh fold instead of throwing, whatever broke', () => {
    const { projection } = build()
    const payloads: readonly unknown[] = [
      // Torn write: barely any shape at all.
      { tracker: { version: ACTIVITY_PROJECTION_STATE_VERSION, phase: 'busy' }, updatedAt: 5 },
      // Phase corrupted, everything else intact — the case the numeric
      // guards cannot see (`render` would return nothing for an unknown
      // phase, which is what makes this payload dangerous).
      corrupted(tracker => { tracker.phase = 'busy' }),
      // An anchor clock corrupted.
      corrupted(tracker => { tracker.turnStartedAt = 'when?' }),
    ]
    for (const payload of payloads) {
      // `view` runs inside the host's synchronous dispatch: it must answer.
      const view = projection.view(payload) as WorkingActivityView
      expect(view.phase).toBe('idle')
      expect(view.line).toBe('')
      // And the fold continues from the fresh state.
      const next = projection.apply(payload, event('turn/start', START, { turn: 1 }))
      expect((projection.view(next) as WorkingActivityView).phase).toBe('waiting')
    }
  })
})

describe('the waiting pool ends when output exists', () => {
  const waiting = new Set<string>([...WAITING_PHRASES, ...EN_WAITING_PHRASES])
  /** The thinking side includes the long-thinking tier pools. */
  const thinking = new Set<string>([
    ...THINKING_PHRASES, ...EN_THINKING_PHRASES,
    ...THINKING_TIERS.flatMap(tier => [...tier.pool]),
    ...EN_THINKING_TIERS.flatMap(tier => [...tier.pool]),
  ])

  it('a live first-token overlay promotes the fold out of the waiting pool', () => {
    // rc.2 reality: deltas are transient frames and never fold, so between
    // the first token and the next durable event the fold still says waiting —
    // reported live, the line said "still queuing" while the model had been
    // writing for a minute. The host hands the first-token instant over with
    // the narration overlay.
    let current = START
    const overlay = {
      narration: '修池切换的问题',
      lastChunkAt: START + 2_000,
      firstTokenAt: START + 2_000,
    }
    const projection = createActivityProjection({
      trackerConfig: CONFIG,
      now: () => current,
      lang: () => 'zh',
      live: () => overlay,
    })
    let state = projection.init()
    state = projection.apply(state, event('turn/start', START, { turn: 1 }))
    // The honest fold, no host knowledge: waiting copy.
    current = START + 2_500
    const bare = createActivityProjection({
      trackerConfig: CONFIG, now: () => current, lang: () => 'zh',
    })
    const folded = bare.view(state) as WorkingActivityView
    expect(folded.phase).toBe('waiting')
    expect(waiting.has(folded.phrase ?? '')).toBe(true)
    // Narration long stale (past the 5s grace) + the first token: the pool
    // the reader sees must be the THINKING one.
    current = START + 40_000
    const viewed = projection.view(state) as WorkingActivityView
    expect(viewed.phase).toBe('thinking')
    expect(thinking.has(viewed.phrase ?? ''), `thinking phrase expected, got ${viewed.phrase}`).toBe(true)
  })

  it('a settled message promotes a replayed fold to thinking', () => {
    // A fold that never saw frames (a replayed log, a restart) still learns
    // from the durable settlement that tokens existed.
    const { projection, tick } = build()
    let state = projection.init()
    state = projection.apply(state, event('turn/start', START, { turn: 1 }))
    tick(9_000)
    state = projection.apply(state, event('assistant/message', START + 9_000, {
      turn: 1,
      step: 1,
      message: { role: 'assistant', id: 'm1', content: [{ type: 'text', text: '好的' }] },
      usage: { inputTokens: 10, outputTokens: 5 },
    }))
    const viewed = projection.view(state) as WorkingActivityView
    expect(viewed.phase).toBe('thinking')
    expect(thinking.has(viewed.phrase ?? ''), `thinking phrase expected, got ${viewed.phrase}`).toBe(true)
  })
})
