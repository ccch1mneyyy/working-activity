/**
 * Session-projection transport spike — DSH `0.1.7-rc.2` host, no browser.
 *
 * The migration this spike decides: the Web surface used to receive its data
 * through a patch to `@deepseek-ai/dsh-client-runtime` (frozen at `0.1.1-rc.2`,
 * absent from the `0.1.7-rc.2` host line). The replacement candidate is a
 * HOST-REGISTERED session projection with a wire view:
 *
 * ```ts
 * ctx.sessionProjections.register({
 *   key, stateSchema, stateVersion, init, apply,
 *   wire: { viewSchema, view },
 * })
 * ```
 *
 * which the browser would read with `useProjection('workingActivity')`.
 *
 * Four claims, each with a real assertion over the real host:
 *
 * 1. the registration API of `@deepseek-ai/dsh-session-projection@0.1.7-rc.2`
 *    accepts a keyed definition with `init`/`apply`/`stateVersion` and a `wire`
 *    view, and the registration is fiber-owned;
 * 2. `apply` really folds committed durable events, and the folded value is
 *    readable through the supported host-side API (`stateOf`);
 * 3. registering and driving that unit appends NOTHING to the session log —
 *    checked differentially against an identical turn with no unit registered
 *    (the past incident, issue #153, was the plugin APPENDING `activity/status`
 *    rows into the shared log);
 * 4. the wire view the client carrier would ship is produced host-side by
 *    `snapshot()` and by the `onChanged` feed, and the declared `viewSchema` /
 *    `stateSchema` are actually enforced on that path.
 *
 * Everything is synthetic: the session ids, the scripted tool call, and the
 * folded counters are this file's own values. No credentials, no real session
 * or conversation content is read or printed.
 * @module dsh-working-activity-rc2-compat/projection-spike.spec
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES, SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: loads the `ctx.sessionProjections` Context merge and the
// ProjectionDefinition / SessionProjectionMap contract this file registers
// against (`dsh-session-projection/lib/types/index.d.ts`).
import type {} from '@deepseek-ai/dsh-session-projection'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import * as WorkingActivity from 'dsh-working-activity'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

// ---------------------------------------------------------------------------
// 1. The merge-extensible projection tables.
//
// `SessionProjectionStateMap` / `SessionProjectionMap` are declared EMPTY in
// `dsh-session-projection/lib/types/types.d.ts:16,23` and are the documented
// merge target ("Domain packages merge their client-visible key here"). The
// `/types` outlet is the one the registry itself imports from
// (`lib/types/index.d.ts:28`), so augmenting it lands on the same symbol the
// `register()` signature reads.
// ---------------------------------------------------------------------------

/** Host fold state: plain JSON by the unit contract. */
interface SpikeState {
  readonly turnStarts: number
  readonly turnEnds: number
  readonly toolCalls: number
  readonly lastSeq: number
}

/** Client view: the whole value a browser would receive for this key. */
interface SpikeView {
  readonly phase: 'waiting' | 'working' | 'done'
  readonly turnStarts: number
  readonly turnEnds: number
  readonly toolCalls: number
  readonly asOfSeq: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Fold-state table entry for the spike unit. */
    workingActivitySpike: SpikeState
    /** Negative control: a unit whose `view` violates its own `viewSchema`. */
    workingActivitySpikeBadWire: { readonly toolCalls: number }
  }
  interface SessionProjectionMap {
    /** Client-visible wire value for the spike unit. */
    workingActivitySpike: SpikeView
    /** Negative control wire value (deliberately invalid on the wire). */
    workingActivitySpikeBadWire: { readonly toolCalls: string }
  }
}

/** The key a real domain unit would register (shipped name would be `workingActivity`). */
const SPIKE_KEY = 'workingActivitySpike'
/** Negative-control key: proves `viewSchema` is enforced, not decorative. */
const BAD_WIRE_KEY = 'workingActivitySpikeBadWire'
/** Call id the scripted tool call and its result share. */
const CALL_ID = 'rc2-spike-call-1'
/** State version of the spike unit (a non-negative integer is enforced at register time). */
const SPIKE_STATE_VERSION = 1

/** The empty-log state, as `init` returns it. */
const ZERO_STATE: SpikeState = { turnStarts: 0, turnEnds: 0, toolCalls: 0, lastSeq: -1 }

/**
 * Runtime `zod` instance.
 *
 * `stateSchema`/`viewSchema` are declared `ZodType` (`lib/types/index.d.ts:42,62`),
 * so the definition needs real zod schemas. This fixture's ROOT cannot
 * `import 'zod'`: pnpm's strict layout keeps it at `.pnpm/zod@4.6.5/...`,
 * reachable only through `dsh-session-projection`'s own dependency edge
 * (verified: `require.resolve('zod')` from the fixture root → MODULE_NOT_FOUND).
 * Loading it through that edge keeps this spike dependency-free. The schemas
 * are real and their enforcement is asserted below, so the benefit of a
 * compile-time `ZodType` annotation is not load-bearing here.
 */
const fixtureRequire = createRequire(import.meta.url)
const projectionRequire = createRequire(
  fixtureRequire.resolve('@deepseek-ai/dsh-session-projection/package.json'),
)
const z = projectionRequire('zod').z

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

/** Counts of one event recording, by durable event type. */
type TypeCounts = Record<string, number>

/** One wire frame observed on the host change feed. */
interface WireFrame {
  /** Projection key the frame belongs to. */
  readonly key: string
  /** The unit's watermark at emission. */
  readonly seq: number
  /** The schema-validated whole value the carrier would ship. */
  readonly value: unknown
}

/** Options for one scripted spike turn. */
interface SpikeTurnOptions {
  /** Register the spike unit before the Session exists (default `true`). */
  readonly projection?: boolean
  /** Observe the client change feed; attach BEFORE the turn to see frames. */
  readonly observeChanges?: boolean
  /** Mount the real `dsh-working-activity` plugin at its DEFAULT config. */
  readonly plugin?: boolean
  /** Mount the plugin with the legacy log-writing sink ON (`publish: true`). */
  readonly pluginPublish?: boolean
  /**
   * Observe each committed event from the recorder. The recorder is registered
   * AFTER the registry's own `session/event` drive, and cordis dispatches
   * listeners synchronously in registration order (`cordis/lib/index.js:280-282`),
   * so this callback runs with the projection already driven for that event.
   */
  readonly onDurable?: (session: Session, event: SessionEvent, ctx: Context) => void
  /** Session id for this run (synthetic). */
  readonly sessionId: string
}

/** One completed spike turn. */
interface SpikeTurn {
  /** The Session the turn ran on. */
  readonly session: Session
  /** Every durable event the context published, in commit order. */
  readonly durable: readonly SessionEvent[]
  /** The durable event types, in commit order. */
  readonly durableTypes: readonly string[]
  /** Wire frames seen on the host change feed, in emission order. */
  readonly frames: readonly WireFrame[]
}

/** Mount the real host services every case shares (no plugin, no adapter yet). */
async function mountHost(ctx: Context): Promise<void> {
  // On this host line the testkit mounts LlmRuntime, SessionStore,
  // SessionProjectionRegistry, SystemPrompt, ToolRuntime and AgentRegistry.
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.tools.register(defineContentToolFixture({
    name: 'mock_ls',
    description: 'List files (spike)',
    parameters: { path: { type: 'string' } },
    async execute() {
      return [{ type: 'text', text: 'file-a.txt' }]
    },
  }))
}

/** Resolve once the target agent returns to idle; attach BEFORE the followup. */
function idleWaiter(ctx: Context, agent: Agent): Promise<void> {
  return new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Register the scripted adapter: tool call first, then plain text. */
function scriptToolTurn(ctx: Context): void {
  ctx.llm.registerAdapter(['mock'], new MockAdapter([
    toolCallResponse(CALL_ID, 'mock_ls', { path: 'src/dir' }),
    textResponse('Done listing.'),
  ]))
}

/**
 * Register the spike unit exactly as the declared shape documents it.
 *
 * Mirrors `dsh-session-projection/lib/types/index.d.ts:38-80`
 * (`ProjectionDefinition`) and the registering overload at `:150-152`.
 * @param ctx - host context carrying the `sessionProjections` service.
 * @returns the exact disposer `register()` hands back.
 */
function registerSpikeUnit(ctx: Context): () => void {
  return ctx.sessionProjections.register({
    key: SPIKE_KEY,
    // Validates persisted state before it seeds a fold.
    stateSchema: z.object({
      turnStarts: z.number(),
      turnEnds: z.number(),
      toolCalls: z.number(),
      lastSeq: z.number(),
    }),
    stateVersion: SPIKE_STATE_VERSION,
    // State for the empty log.
    init: () => ZERO_STATE,
    // Pure transition; an uninterested event MUST return the same reference.
    apply: (state, event) => {
      switch (event.type) {
        case 'turn/start': return { ...state, turnStarts: state.turnStarts + 1, lastSeq: event.seq }
        case 'turn/end': return { ...state, turnEnds: state.turnEnds + 1, lastSeq: event.seq }
        case 'tool/call': return { ...state, toolCalls: state.toolCalls + 1, lastSeq: event.seq }
        default: return state
      }
    },
    // Client view.
    wire: {
      viewSchema: z.object({
        phase: z.enum(['waiting', 'working', 'done']),
        turnStarts: z.number(),
        turnEnds: z.number(),
        toolCalls: z.number(),
        asOfSeq: z.number(),
      }),
      view: state => ({
        phase: state.turnEnds > 0 && state.turnEnds >= state.turnStarts
          ? 'done'
          : state.turnStarts > 0 ? 'working' : 'waiting',
        turnStarts: state.turnStarts,
        turnEnds: state.turnEnds,
        toolCalls: state.toolCalls,
        asOfSeq: state.lastSeq,
      }),
    },
  })
}

/**
 * Register the negative-control unit whose `view` violates its `viewSchema`.
 *
 * This definition does NOT compile as a typed registration, and that rejection
 * is itself evidence: written as a plain `register({ ... })` call, `tsc` fails
 * with
 *
 * ```
 * projection-spike.spec.ts(268,25): error TS2769: No overload matches this call.
 *   Overload 1 of 2, '(definition: Omit<ProjectionDefinition<"workingActivitySpikeBadWire",
 *   { readonly toolCalls: number }>, "wire"> & { wire: { viewSchema: ZodType<{ readonly
 *   toolCalls: string }>, ... view(state: ...): { ... } }>): () => void', gave the
 *   following error:
 *     Type 'number' is not assignable to type 'string'.
 * ```
 *
 * so the `SessionProjectionMap` entry is enforced on the producer side at
 * compile time. The check asserted below is the RUNTIME one: `viewSchema` on
 * the way out of the host. It goes through the type-erased registration face
 * the registry itself uses internally.
 * @param ctx - host context carrying the `sessionProjections` service.
 * @returns the disposer for the negative-control unit.
 */
function registerBadWireUnit(ctx: Context): () => void {
  const registry = ctx.sessionProjections
  const erasedRegister = registry.register.bind(registry) as unknown as (definition: unknown) => () => void
  return erasedRegister({
    key: BAD_WIRE_KEY,
    stateSchema: z.object({ toolCalls: z.number() }),
    stateVersion: 1,
    init: () => ({ toolCalls: 0 }),
    apply: (state: { toolCalls: number }) => state,
    wire: {
      // Declares a string where `view` returns a number.
      viewSchema: z.object({ toolCalls: z.string() }),
      view: (state: { toolCalls: number }) => ({ toolCalls: state.toolCalls }),
    },
  })
}

/**
 * Run one scripted tool turn against a freshly mounted host.
 * @param ctx - context this case owns and disposes.
 * @param options - what to register before the Session exists.
 * @returns the Session, its durable recording, and any wire frames.
 */
async function runSpikeTurn(ctx: Context, options: SpikeTurnOptions): Promise<SpikeTurn> {
  await mountHost(ctx)
  if (options.projection !== false) registerSpikeUnit(ctx)
  const frames: WireFrame[] = []
  if (options.observeChanges === true) {
    // The feed must be attached before the turn: the drive only computes a
    // wire view while a change listener exists (lib/index.js:419-425).
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      frames.push({ key, seq: seq as number, value })
    })
  }
  if (options.plugin === true) await ctx.plugin(WorkingActivity, {})
  // The legacy sink: the exact configuration that caused issue #153.
  if (options.pluginPublish === true) await ctx.plugin(WorkingActivity, { publish: true, lang: 'zh' })
  // The supported post-commit feed. `session.events` does not exist on this
  // host line and `snapshotEvents()` is marked "new calls are prohibited", so
  // this is the same feed the projection drive and the plugin consume.
  const durable: SessionEvent[] = []
  ctx.on('session/event', (session, event) => {
    durable.push(event)
    options.onDurable?.(session, event, ctx)
  })
  scriptToolTurn(ctx)

  const agent = await ctx.agentLoop.create(SessionId(options.sessionId), { provider: 'mock', model: 'mock' })
  const idle = idleWaiter(ctx, agent)
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'list files' }],
    source: { kind: 'user' },
  }))
  await idle
  // Let async publishes and timers settle.
  await new Promise(resolve => setTimeout(resolve, 20))

  return {
    session: agent.session,
    durable,
    durableTypes: durable.map(event => event.type),
    frames,
  }
}

/** Count events of the given types in one recording. */
function countTypes(events: readonly SessionEvent[], types: readonly string[]): TypeCounts {
  const counts: TypeCounts = {}
  for (const type of types) counts[type] = 0
  for (const event of events) {
    const type = event.type as string
    if (type in counts) counts[type] = (counts[type] ?? 0) + 1
  }
  return counts
}

/**
 * Keys-and-types-only fingerprint of one JSON value.
 * Never returns a value, only its structural type.
 */
function shapeOf(value: unknown): unknown {
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.length === 0 ? '[]' : ['array', shapeOf(value[0])]
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, shapeOf(nested)]),
    )
  }
  return typeof value
}

/** Sorted distinct durable event types of one recording. */
function distinct(types: readonly string[]): string[] {
  return [...new Set(types)].sort()
}

describe('session projection with a wire view on DSH 0.1.7-rc.2 (no browser)', () => {
  // -------------------------------------------------------------------------
  // Claim 1 — the registration API works on the real host.
  // -------------------------------------------------------------------------
  it('CLAIM 1: registers a keyed unit with init/apply/stateVersion + a wire view', async () => {
    const ctx = new Context()
    try {
      await mountHost(ctx)
      const registry = ctx.sessionProjections
      console.log(`[spike 1] ctx.sessionProjections = ${registry?.constructor?.name}`)
      console.log(`[spike 1] register() is a function: ${typeof registry.register === 'function'}`)
      console.log(`[spike 1] onChanged() is a function: ${typeof registry.onChanged === 'function'}`)

      const dispose = registerSpikeUnit(ctx)
      console.log(`[spike 1] register() returned: ${typeof dispose}`)

      const agent = await ctx.agentLoop.create(SessionId('rc2-spike-register'), { provider: 'mock', model: 'mock' })
      const session = agent.session
      // The registration exists BEFORE the Session, so the registry seeded the
      // cell from `init` on `session/created` (lib/index.js:53-63).
      const init = registry.stateOf(session, SPIKE_KEY)
      console.log(`[spike 1] stateOf() right after create(): ${JSON.stringify(init)}`)
      // The same seat already carries the HOST's own client-visible units: this
      // is a first-class framework seam, not a plugin-private channel.
      console.log(`[spike 1] snapshot() keys while registered: ${JSON.stringify(Object.keys(registry.snapshot(session).values).sort())}`)

      // Documented behavior: a non-negative integer stateVersion (lib/index.js:81).
      // Read through the type-erased registration face so this hostile input is
      // expressible at all (the declarations only admit valid definitions). The
      // guard fires before the method touches `this`, but bind anyway so the
      // assertion cannot silently start testing a TypeError instead.
      const erasedRegister = registry.register.bind(registry) as unknown as (definition: unknown) => () => void
      expect(() => erasedRegister({
        key: SPIKE_KEY,
        stateSchema: z.object({}),
        stateVersion: 0.5,
        init: () => ZERO_STATE,
        apply: (state: SpikeState) => state,
      })).toThrow(/stateVersion must be a non-negative integer/)

      expect(typeof dispose).toBe('function')
      expect(init).toEqual(ZERO_STATE)

      // Registration is an effect on the calling fiber: the exact disposer
      // removes the key (lib/types/index.d.ts:142-152).
      dispose()
      const afterDispose = registry.snapshot(session).values
      console.log(`[spike 1] after dispose(): stateOf = ${String(registry.stateOf(session, SPIKE_KEY))}`)
      console.log(`[spike 1] after dispose(): snapshot() keys = ${JSON.stringify(Object.keys(afterDispose).sort())}`)
      expect(registry.stateOf(session, SPIKE_KEY)).toBeUndefined()
      expect(registry.snapshot(session, [SPIKE_KEY]).values[SPIKE_KEY]).toBeUndefined()
      // Only this unit's key disappeared: the host's own units survive.
      expect(Object.keys(afterDispose)).not.toContain(SPIKE_KEY)
      expect(Object.keys(afterDispose).length).toBeGreaterThan(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  // -------------------------------------------------------------------------
  // Claim 2 — values actually flow.
  // -------------------------------------------------------------------------
  it('CLAIM 2: folds committed events and reads the value back with stateOf()', async () => {
    const ctx = new Context()
    try {
      const turn = await runSpikeTurn(ctx, { sessionId: 'rc2-spike-fold' })
      const counted = countTypes(turn.durable, ['turn/start', 'turn/end', 'tool/call'])
      const state = ctx.sessionProjections.stateOf(turn.session, SPIKE_KEY)

      console.log(`[spike 2] durable counts (independent recorder): ${JSON.stringify(counted)}`)
      console.log(`[spike 2] stateOf() fold state: ${JSON.stringify(state)}`)
      console.log(`[spike 2] session.seq (events committed): ${String(turn.session.seq)}`)
      console.log(`[spike 2] snapshot().asOfSeq: ${String(ctx.sessionProjections.snapshot(turn.session).asOfSeq)}`)

      expect(state).toBeDefined()
      // The fold is driven by the registry's OWN subscription over the same
      // committed feed the recorder sees: both must agree, event for event.
      expect(state?.turnStarts).toBe(counted['turn/start'])
      expect(state?.turnEnds).toBe(counted['turn/end'])
      expect(state?.toolCalls).toBe(counted['tool/call'])
      // Non-trivial: the scripted turn really produced all three.
      expect(state?.turnStarts).toBe(1)
      expect(state?.turnEnds).toBe(1)
      expect(state?.toolCalls).toBe(1)
      // `stateOf` returns the LIVE cell (declared at lib/types/index.d.ts:170):
      // two reads are the same reference, not a copy.
      expect(ctx.sessionProjections.stateOf(turn.session, SPIKE_KEY))
        .toBe(ctx.sessionProjections.stateOf(turn.session, SPIKE_KEY))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('CLAIM 2b: the fold is already current inside the commit dispatch (eager drive, same tick)', async () => {
    const ctx = new Context()
    try {
      const observed: { type: string; seq: number; cachedAsOfSeq: number | undefined }[] = []
      const turn = await runSpikeTurn(ctx, {
        sessionId: 'rc2-spike-latency',
        onDurable: (session, event, hookCtx) => {
          // `cachedSnapshot` reads only ALREADY-MATERIALIZED cells — it never
          // folds history (lib/types/index.d.ts:186-194). If the drive were
          // lazy, the watermark would trail the event being dispatched.
          const cached = hookCtx.sessionProjections.cachedSnapshot(session, [SPIKE_KEY])
          observed.push({ type: event.type, seq: event.seq, cachedAsOfSeq: cached?.asOfSeq })
        },
      })
      const lagging = observed.filter(row => row.cachedAsOfSeq !== row.seq)
      console.log(`[spike 2b] events dispatched: ${observed.length}, durable recorded: ${turn.durable.length}`)
      console.log(`[spike 2b] events whose cached watermark trailed the dispatch: ${JSON.stringify(lagging)}`)
      console.log(`[spike 2b] (type, seq, cachedAsOfSeq) = ${JSON.stringify(observed.map(r => [r.type, r.seq, r.cachedAsOfSeq]))}`)

      expect(observed.length).toBe(turn.durable.length)
      expect(observed.length).toBeGreaterThan(0)
      expect(lagging).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  // -------------------------------------------------------------------------
  // Claim 3 — nothing lands in the session log.
  // -------------------------------------------------------------------------
  it('CLAIM 3: appends nothing to the session log (differential vs. no unit registered)', async () => {
    const baseCtx = new Context()
    const spikeCtx = new Context()
    try {
      const baseline = await runSpikeTurn(baseCtx, { projection: false, sessionId: 'rc2-spike-baseline' })
      const projected = await runSpikeTurn(spikeCtx, { projection: true, sessionId: 'rc2-spike-projected' })

      console.log(`[spike 3] baseline (no projection) durable types: ${JSON.stringify(baseline.durableTypes)}`)
      console.log(`[spike 3] projected (unit registered) durable types: ${JSON.stringify(projected.durableTypes)}`)
      console.log(`[spike 3] baseline distinct types:  ${JSON.stringify(distinct(baseline.durableTypes))}`)
      console.log(`[spike 3] projected distinct types: ${JSON.stringify(distinct(projected.durableTypes))}`)

      // The decisive property: the two recordings are the SAME sequence.
      expect(projected.durableTypes).toEqual(baseline.durableTypes)
      // And no projection/activity vocabulary is present at all.
      const suspicious = projected.durableTypes.filter(type => /projection|activity|spike/i.test(type))
      console.log(`[spike 3] event types matching /projection|activity|spike/i: ${JSON.stringify(suspicious)}`)
      expect(suspicious).toEqual([])
      // `workingActivitySpike` is a projection KEY, never a log event type.
      expect(KNOWN_SESSION_EVENT_TYPES.has(SPIKE_KEY)).toBe(false)
      expect(projected.durableTypes).not.toContain('activity/status')
    } finally {
      await spikeCtx.fiber.dispose()
      await baseCtx.fiber.dispose()
    }
  })

  // -------------------------------------------------------------------------
  // Claim 4 — the wire view is what a client would read.
  // -------------------------------------------------------------------------
  it('CLAIM 4: serves the client wire value through snapshot() and the onChanged feed', async () => {
    const ctx = new Context()
    try {
      const turn = await runSpikeTurn(ctx, { sessionId: 'rc2-spike-wire', observeChanges: true })
      const registry = ctx.sessionProjections
      const snapshot = registry.snapshot(turn.session, [SPIKE_KEY])
      const value = snapshot.values[SPIKE_KEY]

      console.log(`[spike 4] snapshot().asOfSeq = ${String(snapshot.asOfSeq)}`)
      console.log(`[spike 4] snapshot().values keys = ${JSON.stringify(Object.keys(snapshot.values))}`)
      console.log(`[spike 4] wire value shape = ${JSON.stringify(shapeOf(value))}`)
      console.log(`[spike 4] wire value = ${JSON.stringify(value)}`)
      console.log(`[spike 4] onChanged frames (key, seq): ${JSON.stringify(turn.frames.map(f => [f.key, f.seq]))}`)
      console.log(`[spike 4] onChanged frame value shapes = ${JSON.stringify(turn.frames.map(f => shapeOf(f.value)))}`)

      expect(value).toBeDefined()
      expect(value?.phase).toBe('done')
      expect(value?.turnStarts).toBe(1)
      expect(value?.turnEnds).toBe(1)
      expect(value?.toolCalls).toBe(1)
      expect(value?.asOfSeq).toBe(turn.session.seq - 1)
      expect(snapshot.asOfSeq).toBe(turn.session.seq - 1)
      // Every leaf the carrier ships is wire-JSON.
      const leaves = Object.values(shapeOf(value) as Record<string, string>)
      expect(leaves.every(leaf => ['string', 'number', 'boolean', 'null'].includes(leaf))).toBe(true)

      // The change feed carried the same whole value the baseline serves; the
      // Session Controller turns exactly these into `{ type: 'projection',
      // sessionId, key, value, seq }` frames (see the report). The feed is
      // HOST-WIDE and key-multiplexed, so a carrier must filter by key — the
      // host's own `inbox` unit shares it.
      const spikeFrames = turn.frames.filter(frame => frame.key === SPIKE_KEY)
      console.log(`[spike 4] distinct keys on one session's change feed: ${JSON.stringify(distinct(turn.frames.map(f => f.key)))}`)
      console.log(`[spike 4] spike frames (seq, value) = ${JSON.stringify(spikeFrames.map(f => [f.seq, f.value]))}`)
      expect(turn.frames.length).toBeGreaterThan(0)
      expect(distinct(turn.frames.map(frame => frame.key)).length).toBeGreaterThan(1)
      expect(spikeFrames.length).toBeGreaterThan(0)
      expect(spikeFrames.at(-1)?.value).toEqual(value)
      expect(spikeFrames.at(-1)?.seq).toBe(turn.session.seq - 1)
      // Only state-changing events emit a view: nothing fires for step/*,
      // tool/result or the other events the fold ignores.
      expect(spikeFrames.length).toBe(3)
      expect(spikeFrames.map(frame => (frame.value as SpikeView).phase)).toEqual(['working', 'working', 'done'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('CLAIM 4b: enforces viewSchema and stateSchema, and serves the zero-I/O rung', async () => {
    const ctx = new Context()
    try {
      await mountHost(ctx)
      registerSpikeUnit(ctx)
      registerBadWireUnit(ctx)
      const registry = ctx.sessionProjections
      const agent = await ctx.agentLoop.create(SessionId('rc2-spike-schema'), { provider: 'mock', model: 'mock' })

      // viewSchema is enforced before a value leaves the host.
      let thrown: unknown
      try {
        registry.snapshot(agent.session, [BAD_WIRE_KEY])
      } catch (error) {
        thrown = error
      }
      console.log(`[spike 4b] bad-view snapshot threw: ${thrown === undefined ? 'no' : (thrown as Error).name}`)
      console.log(`[spike 4b] bad-view error: ${thrown === undefined ? '-' : String((thrown as Error).message).slice(0, 120)}`)
      expect(thrown).toBeDefined()

      // The zero-I/O rung: a stored row + its `view`, no Session, no log read.
      const usable = registry.viewCheckpoint(
        { [SPIKE_KEY]: { ver: SPIKE_STATE_VERSION, seq: -1, val: ZERO_STATE } },
        [SPIKE_KEY],
      )
      console.log(`[spike 4b] viewCheckpoint(usable row) = ${JSON.stringify(usable)}`)
      expect(usable[SPIKE_KEY]).toEqual({
        phase: 'waiting', turnStarts: 0, turnEnds: 0, toolCalls: 0, asOfSeq: -1,
      })

      // stateSchema rejects a malformed stored state -> the key stays absent.
      const malformed = registry.viewCheckpoint(
        { [SPIKE_KEY]: { ver: SPIKE_STATE_VERSION, seq: -1, val: { nonsense: true } } },
        [SPIKE_KEY],
      )
      console.log(`[spike 4b] viewCheckpoint(malformed state) keys = ${JSON.stringify(Object.keys(malformed))}`)
      expect(malformed[SPIKE_KEY]).toBeUndefined()

      // A stateVersion mismatch discards the row (cache invalidation contract).
      const stale = registry.viewCheckpoint(
        { [SPIKE_KEY]: { ver: SPIKE_STATE_VERSION + 1, seq: -1, val: ZERO_STATE } },
        [SPIKE_KEY],
      )
      console.log(`[spike 4b] viewCheckpoint(ver mismatch) keys = ${JSON.stringify(Object.keys(stale))}`)
      expect(stale[SPIKE_KEY]).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  // -------------------------------------------------------------------------
  // Claim 3, applied to the real shipped composition.
  // -------------------------------------------------------------------------
  it('CLAIM 3b: the plugin + projection composition is still log-silent', async () => {
    const ctx = new Context()
    try {
      const turn = await runSpikeTurn(ctx, { sessionId: 'rc2-spike-plugin', plugin: true })
      console.log(`[spike 3b] durable types with the plugin mounted at DEFAULT config: ${JSON.stringify(turn.durableTypes)}`)
      console.log(`[spike 3b] activity/status rows in the log: ${turn.durableTypes.filter(t => t === 'activity/status').length}`)
      console.log(`[spike 3b] stateOf() = ${JSON.stringify(ctx.sessionProjections.stateOf(turn.session, SPIKE_KEY))}`)

      // The plugin still REGISTERS its log-only event type at load
      // (`registerActivityEventType()`), but with `publish` at its default
      // (false) it never WRITES one: vocabulary knowledge is not a log append.
      expect(KNOWN_SESSION_EVENT_TYPES.has('activity/status')).toBe(true)
      expect(turn.durableTypes).not.toContain('activity/status')
      expect(turn.durableTypes.filter(type => /projection|activity|spike/i.test(type))).toEqual([])
      expect(ctx.sessionProjections.stateOf(turn.session, SPIKE_KEY)?.toolCalls).toBe(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('CLAIM 3c (NON-VACUITY CONTROL): the legacy publish:true sink DOES dirty the log', async () => {
    const ctx = new Context()
    try {
      const turn = await runSpikeTurn(ctx, { sessionId: 'rc2-spike-legacy-publish', pluginPublish: true })
      const statusRows = turn.durableTypes.filter(type => type === 'activity/status')
      const appended = turn.durable.filter(event => (event.type as string) === 'activity/status')
      console.log(`[spike 3c] durable types with publish:true: ${JSON.stringify(turn.durableTypes)}`)
      console.log(`[spike 3c] activity/status rows appended: ${statusRows.length}`)
      console.log(`[spike 3c] activity/status seqs: ${JSON.stringify(appended.map(event => event.seq))}`)

      // This is the failure mode issue #153 was: the OLD transport writes into
      // the shared log. Asserting it HERE proves claim 3's negative result is
      // not vacuous — the very same recorder observes appended rows.
      expect(statusRows.length).toBeGreaterThan(0)
      // ...and those rows are exactly what claim 3's pattern filter rejects.
      expect(turn.durableTypes.filter(type => /projection|activity|spike/i.test(type)).length)
        .toBeGreaterThan(0)
      // The projection itself still folds correctly alongside the legacy sink.
      expect(ctx.sessionProjections.stateOf(turn.session, SPIKE_KEY)?.toolCalls).toBe(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
