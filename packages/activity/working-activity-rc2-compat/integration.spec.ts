/**
 * DSH `0.1.7-rc.2` host integration fixture.
 *
 * This file mounts the REAL host in-process — `Context`, the agent-loop
 * testkit prerequisites, the real `AgentLoop`, the packaged
 * `dsh-working-activity` plugin, and a scripted mock adapter — then runs real
 * turns. It answers three questions:
 *
 * 1. **Scope probe.** Does a plugin mounted through `ctx.plugin(...)` (the way
 *    any third-party plugin is mounted) actually receive the transient
 *    `agent/assistant-stream` frames of the current host, or only a listener on
 *    the root context? Zero frames at either level is a critical finding.
 * 2. **P0 reproduction.** With `dsh-working-activity@0.4.0` on this host the
 *    tool phase must never settle: `tool/result` carries its call id on
 *    `message.source.callId` while the tracker reads
 *    `message.content[0].toolCallId`, so the status line stays pinned on the
 *    turn's first tool until `turn/end` and the done line counts 0 tools. These
 *    cases are expected RED until `src/` is migrated; the failure is the point.
 * 3. **Fixture honesty.** `fixtures.ts` encodes both wire generations, and the
 *    assertions there prove neither generation leaks into the other, so a later
 *    "just put both in" edit cannot pass silently.
 * @module dsh-working-activity-rc2-compat/integration.spec
 */

import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES, SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as WorkingActivity from 'dsh-working-activity'
import {
  isLegacyContentCallId,
  keyPaths,
  legacyToolResult,
  modernAssistantStreamFrames,
  modernToolResult,
} from './fixtures.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

/** Call id shared by the scripted tool call and the fixture/assertion pairs. */
const CALL_ID = 'rc2-call-1'

/** The published snapshot fields these cases assert on. */
interface ActivitySnapshot {
  readonly phase: string
  readonly line: string
  readonly toolCount: number
}

/** Counts of one recording, by transient frame type. */
interface FrameCounts {
  readonly start: number
  readonly chunk: number
  readonly end: number
}

/** One session's durable events, in commit order. */
interface SessionEventRecorder {
  /** Events published for one session, in commit order. */
  eventsOf(session: Session): readonly SessionEvent[]
}

/**
 * Record the durable events this context publishes. On this host line the
 * synchronous log reads (`session.events`) are gone and the surviving
 * `snapshotEvents()` is marked "new calls are prohibited", so the fixture
 * consumes the supported post-commit `session/event` feed — the same feed the
 * plugin under test folds.
 */
function recordSessionEvents(ctx: Context): SessionEventRecorder {
  const entries: { session: Session; event: SessionEvent }[] = []
  ctx.on('session/event', (session, event) => { entries.push({ session, event }) })
  return {
    eventsOf: session => entries
      .filter(entry => entry.session === session)
      .map(entry => entry.event),
  }
}

/** Concatenated text of one event's message content, when it carries any. */
function messageText(event: SessionEvent): string {
  const data = event.data as unknown as {
    message?: { content?: readonly { type?: string; text?: string }[] }
  }
  return (data.message?.content ?? [])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

/** Mount the real host services every case in this file shares. */
async function mountHost(ctx: Context): Promise<void> {
  // This host line's testkit already mounts LlmRuntime, SessionStore,
  // SessionProjectionRegistry, SystemPrompt, ToolRuntime, and AgentRegistry —
  // the alpha.2 fixture mounted the projection registry itself, and doing that
  // here throws a duplicate-service registration.
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.tools.register(defineContentToolFixture({
    name: 'mock_ls',
    description: 'List files (mock)',
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
function scriptToolTurn(ctx: Context): MockAdapter {
  const adapter = new MockAdapter([
    toolCallResponse(CALL_ID, 'mock_ls', { path: 'src/dir' }),
    textResponse('Done listing.'),
  ])
  ctx.llm.registerAdapter(['mock'], adapter)
  return adapter
}

/** The `⏵` self-narration line the plugin is contracted to surface live. */
const NARRATION = '正在修登录页样式'

/** Register a scripted adapter that streams one narrated text answer. */
function scriptNarratedTurn(ctx: Context): MockAdapter {
  const adapter = new MockAdapter([
    textResponse(`⏵ ${NARRATION}。\n\n完事。`),
  ])
  ctx.llm.registerAdapter(['mock'], adapter)
  return adapter
}

/** Create one scripted agent and drive it to idle. */
async function runToolTurn(ctx: Context, sessionId: string, prompt = 'list files'): Promise<Agent> {
  // On this host line `AgentLoop.create()` is async (it awaits unpublished
  // setup and the ordered `agent/created` listeners before publishing).
  const agent = await ctx.agentLoop.create(SessionId(sessionId), { provider: 'mock', model: 'mock' })
  const idle = idleWaiter(ctx, agent)
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }))
  await idle
  // Let the plugin's microtask publishes and its tick timer settle.
  await new Promise(resolve => setTimeout(resolve, 20))
  return agent
}

/** Select the working-activity snapshots from a session transcript. */
function activitySnapshots(log: readonly SessionEvent[]): ActivitySnapshot[] {
  return log
    .filter(event => event.type === 'activity/status')
    .map(event => event.data as unknown as ActivitySnapshot)
}

/** Count one recording's frames by type. */
function frameCounts(frames: readonly AssistantStreamFrame[]): FrameCounts {
  return {
    start: frames.filter(frame => frame.type === 'start').length,
    chunk: frames.filter(frame => frame.type === 'chunk').length,
    end: frames.filter(frame => frame.type === 'end').length,
  }
}

/** Distinct attempt ids seen in one recording. */
function attemptIds(frames: readonly AssistantStreamFrame[]): string[] {
  return [...new Set(frames.map(frame => String(frame.attemptId)))].sort()
}

/** Mount the plugin, run one scripted turn, and collect its snapshots. */
async function runActivityTurn(
  sessionId: string,
  script: (ctx: Context) => void = scriptToolTurn,
  prompt = 'list files',
): Promise<{ readonly events: readonly SessionEvent[]; readonly snapshots: readonly ActivitySnapshot[] }> {
  const ctx = new Context()
  let activityFiber: Fiber | undefined
  try {
    await mountHost(ctx)
    const recorder = recordSessionEvents(ctx)
    activityFiber = await ctx.plugin(WorkingActivity, { publish: true, lang: 'zh' })
    script(ctx)
    // The plugin registers its own log-only event type at load; without it the
    // strict read paths (and therefore every published snapshot) refuse the log.
    expect(KNOWN_SESSION_EVENT_TYPES.has('activity/status')).toBe(true)
    const agent = await runToolTurn(ctx, sessionId, prompt)
    const events = recorder.eventsOf(agent.session)
    return { events, snapshots: activitySnapshots(events) }
  } finally {
    await activityFiber?.dispose()
    await ctx.fiber.dispose()
  }
}

describe('DSH 0.1.7-rc.2 compatibility', () => {
  // ---------------------------------------------------------------------------
  // (a) Scope probe — the load-bearing question of the migration.
  // ---------------------------------------------------------------------------
  it('delivers agent/assistant-stream frames to a plugin-level listener and to a root listener', async () => {
    const ctx = new Context()
    try {
      await mountHost(ctx)
      // A third-party-shaped probe, mounted exactly like an external plugin.
      const probeFrames: AssistantStreamFrame[] = []
      const probe: Plugin = {
        name: 'rc2-stream-probe',
        apply(probeCtx: Context) {
          probeCtx.on('agent/assistant-stream', ({ frame }) => { probeFrames.push(frame) })
        },
      }
      await ctx.plugin(probe)
      const rootFrames: AssistantStreamFrame[] = []
      ctx.on('agent/assistant-stream', ({ frame }) => { rootFrames.push(frame) })

      scriptToolTurn(ctx)
      const recorder = recordSessionEvents(ctx)
      const agent = await runToolTurn(ctx, 'rc2-stream-probe')
      // `assistant/chunk` is absent from this host line's SessionEventMap, so a
      // literal comparison does not even compile (TS2367); the runtime set is
      // checked below and the string compare keeps the measurement explicit.
      const durableChunks = recorder.eventsOf(agent.session)
        .filter(event => (event.type as string) === 'assistant/chunk').length
      const chunkTypeKnown = KNOWN_SESSION_EVENT_TYPES.has('assistant/chunk')

      console.log(`[rc2 scope probe] plugin-level frames=${probeFrames.length} `
        + `${JSON.stringify(frameCounts(probeFrames))} attempts=${JSON.stringify(attemptIds(probeFrames))}`)
      console.log(`[rc2 scope probe] root-level   frames=${rootFrames.length} `
        + `${JSON.stringify(frameCounts(rootFrames))} attempts=${JSON.stringify(attemptIds(rootFrames))}`)
      console.log(`[rc2 scope probe] durable assistant/chunk events in the session log: ${durableChunks}`)
      console.log(`[rc2 scope probe] KNOWN_SESSION_EVENT_TYPES.has('assistant/chunk')=${chunkTypeKnown}`)

      // The durable stream event of the previous host line is gone; the live
      // frames above are its replacement.
      expect(chunkTypeKnown).toBe(false)
      expect(durableChunks).toBe(0)

      // Frames must reach BOTH levels. A zero here is a critical finding about
      // the migration, not a test to soften: the durable `assistant/chunk`
      // replacement would be invisible to plugins.
      expect(rootFrames.length).toBeGreaterThan(0)
      expect(probeFrames.length).toBeGreaterThan(0)
      const counts = frameCounts(probeFrames)
      expect(counts.start).toBeGreaterThan(0)
      expect(counts.chunk).toBeGreaterThan(0)
      expect(counts.end).toBeGreaterThan(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  // ---------------------------------------------------------------------------
  // (b) P0 reproduction with the real host — expected RED on 0.4.0.
  // ---------------------------------------------------------------------------
  it('P0: the tool phase ends before turn end (a thinking snapshot settles the tool)', async () => {
    const { events, snapshots } = await runActivityTurn('rc2-activity-settle')
    const phases = snapshots.map(snapshot => snapshot.phase)
    console.log(`[rc2 P0/settle] activity/status phases: ${JSON.stringify(phases)}`)
    console.log(`[rc2 P0/settle] snapshots: ${JSON.stringify(snapshots)}`)
    // The feed the plugin folds, in commit order: a failing case must still
    // show `tool/result` was DELIVERED, so the pinned phase can only come from
    // the call id the tracker failed to read.
    console.log(`[rc2 P0/settle] durable event types: ${JSON.stringify(events.map(event => event.type))}`)

    const toolAt = phases.indexOf('tool')
    const doneAt = phases.indexOf('done')
    expect(events.map(event => event.type)).toContain('tool/result')
    expect(toolAt).toBeGreaterThanOrEqual(0)
    expect(doneAt).toBeGreaterThan(toolAt)
    // A settled tool drops the tracker back to `thinking` for the rest of the
    // turn; with the call id unread, the only reachable phase after `tool` is
    // `done`, i.e. the status line stays pinned on the first tool until then.
    const thinkingAfterTool = phases.findIndex(
      (phase, index) => phase === 'thinking' && index > toolAt && index < doneAt,
    )
    expect(thinkingAfterTool).toBeGreaterThan(toolAt)
  })

  it('P0: the final done snapshot counts the tool', async () => {
    const { snapshots } = await runActivityTurn('rc2-activity-count')
    const done = snapshots.findLast(snapshot => snapshot.phase === 'done')
    console.log(`[rc2 P0/count] done snapshot: ${JSON.stringify(done)}`)

    expect(done).toBeDefined()
    expect(done?.toolCount).toBe(1)
    expect(done?.line).toContain('1 工具')
  })

  // ---------------------------------------------------------------------------
  // (b2) Realtime: the line must move on LIVE frames, not only on durable
  // events. On this host line `assistant/chunk` is gone, so a tracker that
  // only folds durable events has no first-token promotion and no `⏵`
  // narration at all: the phase stays `waiting` until the turn ends.
  // ---------------------------------------------------------------------------
  it('P1: surfaces the thinking phase and the ⏵ narration from live stream frames', async () => {
    const { snapshots } = await runActivityTurn('rc2-activity-live', scriptNarratedTurn, 'fix the login page')
    const phases = snapshots.map(snapshot => snapshot.phase)
    console.log(`[rc2 live] activity/status phases: ${JSON.stringify(phases)}`)
    console.log(`[rc2 live] narrated snapshots: ${JSON.stringify(snapshots.filter(s => s.line.includes('⏵')))}`)

    // The promotion must happen on the first streamed token: no tool event ever
    // fires in this turn, so `thinking` can only come from the live frames.
    expect(phases).toContain('thinking')
    const narrated = snapshots.find(snapshot => snapshot.line.includes('⏵'))
    expect(narrated).toBeDefined()
    expect(narrated?.line).toContain(NARRATION)
  })

  // ---------------------------------------------------------------------------
  // Web transport: the plugin registers a client-visible projection, and the
  // real registry drives it over committed events. Nothing may land in the log.
  // ---------------------------------------------------------------------------
  it('registers the workingActivity projection and folds the turn into it', async () => {
    const ctx = new Context()
    let activityFiber: Fiber | undefined
    try {
      await mountHost(ctx)
      activityFiber = await ctx.plugin(WorkingActivity, { publish: false, lang: 'zh' })
      // A consumer (the TUI, or a browser carrier) reads the value two ways: the
      // snapshot it asks for, and the change feed it subscribes to. Both must
      // work off the same unit, so the feed is recorded from before the turn.
      const pushed: { key: string; value: Record<string, unknown> }[] = []
      const off = ctx.sessionProjections.onChanged((_session, key, value) => {
        // The feed is host-wide, so the key is matched as a string here: this
        // fixture must pass whether or not the plugin has taught the host's
        // projection type table about its own key yet.
        if (String(key) === 'workingActivity') pushed.push({ key: String(key), value: value as Record<string, unknown> })
      })
      scriptToolTurn(ctx)
      const agent = await runToolTurn(ctx, 'rc2-projection')

      const snapshot = ctx.sessionProjections.snapshot(agent.session)
      const values = (snapshot as unknown as { values: Record<string, Record<string, unknown>> }).values
      const value = values.workingActivity
      console.log(`[rc2 projection] wire value: ${JSON.stringify(value)}`)
      console.log(`[rc2 projection] change feed: ${pushed.length} pushes, phases ${JSON.stringify(pushed.map(item => item.value.phase))}`)
      off()

      // Reading it proves both halves: the unit registered on this corridor's
      // contract shape, and the host validated our wire value with its schema.
      expect(value).toBeDefined()
      expect(value.phase).toBe('done')
      expect(value.toolCount).toBe(1)
      expect(value.lang).toBe('zh')
      expect(typeof value.turnStartedAt).toBe('number')
      expect(typeof value.updatedAt).toBe('number')
      // The feed a subscriber lives on must actually fire, and its last value
      // must agree with the snapshot — a value that only exists when asked for
      // would leave a push-driven client blank.
      expect(pushed.length).toBeGreaterThan(0)
      expect(pushed.at(-1)?.value.toolCount).toBe(value.toolCount)
      expect(pushed.at(-1)?.value.phase).toBe(value.phase)
    } finally {
      await activityFiber?.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('carries the model self-narration into the projected value', async () => {
    // The reported symptom this pins: with the line driven by a projection, the
    // model's own `⏵` words disappeared. Narration is streamed, and a projection
    // folds committed events only, so the plugin hands the live line over per
    // read (and settled messages carry the durable half).
    const ctx = new Context()
    let activityFiber: Fiber | undefined
    try {
      await mountHost(ctx)
      activityFiber = await ctx.plugin(WorkingActivity, { publish: false, lang: 'zh' })
      const lines: string[] = []
      const off = ctx.sessionProjections.onChanged((_session, key, value) => {
        if (String(key) !== 'workingActivity') return
        const line = (value as { line?: unknown }).line
        if (typeof line === 'string') lines.push(line)
      })
      scriptNarratedTurn(ctx)
      const agent = await runToolTurn(ctx, 'rc2-narration', 'fix the login page')
      off()

      const snapshot = ctx.sessionProjections.snapshot(agent.session)
      const values = (snapshot as unknown as { values: Record<string, Record<string, unknown>> }).values
      const pushedNarration = lines.filter(line => line.includes('⏵'))
      console.log(`[rc2 narration] values pushed: ${lines.length}, narrated: ${pushedNarration.length}`)
      console.log(`[rc2 narration] first narrated push: ${JSON.stringify(pushedNarration[0] ?? null)}`)

      // The live path: the change feed a client lives on must carry the line.
      expect(pushedNarration.length).toBeGreaterThan(0)
      expect(pushedNarration[0]).toContain(NARRATION)
    } finally {
      await activityFiber?.dispose()
      await ctx.fiber.dispose()
    }
  })

  // ---------------------------------------------------------------------------
  // Host seams the plugin mounts through: none of them may throw or go silent.
  // ---------------------------------------------------------------------------
  it('still injects the plugin system-prompt narration section on this host line', async () => {
    const { events } = await runActivityTurn('rc2-system-prompt')
    const system = events.filter(event => event.type === 'system/message')
    const text = system.map(messageText).join('\n')
    console.log(`[rc2 systemPrompt] system/message count=${system.length} `
      + `hasNarrationSection=${text.includes('[状态栏]')} hasArrowMarker=${text.includes('⏵')}`)

    expect(system.length).toBeGreaterThan(0)
    expect(text).toContain('[状态栏]')
    expect(text).toContain('⏵')
  })

  // ---------------------------------------------------------------------------
  // Wire measurement: the real host event the fixtures above encode.
  // ---------------------------------------------------------------------------
  it('records where the real host puts the tool-call id on tool/result', async () => {
    const ctx = new Context()
    try {
      await mountHost(ctx)
      scriptToolTurn(ctx)
      const recorder = recordSessionEvents(ctx)
      const agent = await runToolTurn(ctx, 'rc2-wire-shape')
      const results = recorder.eventsOf(agent.session).filter(event => event.type === 'tool/result')
      expect(results).toHaveLength(1)
      const paths = keyPaths(results[0])
      console.log(`[rc2 wire] real tool/result key paths: ${JSON.stringify(paths)}`)

      expect(paths).toContain('data.message.source.callId')
      expect(paths).toContain('data.message.toolCallId')
      expect(paths.filter(isLegacyContentCallId)).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  // ---------------------------------------------------------------------------
  // (c) Fixture honesty — the two wire generations must stay unmixed.
  // ---------------------------------------------------------------------------
  it('keeps the modern tool/result fixture free of the legacy content call id', () => {
    const modern = modernToolResult(CALL_ID, 'file-a.txt')
    const paths = keyPaths(modern)
    console.log(`[rc2 fixtures] modern tool/result key paths: ${JSON.stringify(paths)}`)

    expect(paths).toContain('message.source.callId')
    expect(paths).toContain('message.toolCallId')
    expect(paths.filter(isLegacyContentCallId)).toEqual([])
    expect(modern.message.source.kind).toBe('tool')
  })

  it('keeps the legacy tool/result fixture free of every modern call-id field', () => {
    const legacy = legacyToolResult(CALL_ID, 'file-a.txt')
    const paths = keyPaths(legacy)
    console.log(`[rc2 fixtures] legacy tool/result key paths: ${JSON.stringify(paths)}`)

    expect(paths).toContain('message.content[0].toolCallId')
    expect(paths).not.toContain('message.toolCallId')
    expect(paths.some(path => /(^|\.)source(\.|$)/.test(path))).toBe(false)
  })

  it('builds both tool/result generations from one call id and one text body', () => {
    const modern = modernToolResult(CALL_ID, 'file-a.txt')
    const legacy = legacyToolResult(CALL_ID, 'file-a.txt')
    expect(modern.message.content[0]).toEqual({ type: 'text', text: 'file-a.txt' })
    expect(legacy.message.content[0]?.content).toEqual([{ type: 'text', text: 'file-a.txt' }])
    expect(legacy.message.content[0]?.toolCallId).toBe(CALL_ID)
    expect(String(modern.message.source.callId)).toBe(CALL_ID)
    expect(String(modern.message.toolCallId)).toBe(CALL_ID)
    expect(modern.turn).toBe(legacy.turn)
    expect(modern.step).toBe(legacy.step)
  })

  it('builds well-formed modern assistant-stream frames', () => {
    const frames = modernAssistantStreamFrames({ chunks: [
      { type: 'text-delta', index: 0, text: 'hello' },
      { type: 'text-delta', index: 0, text: ' world' },
    ] })
    expect(frames.map(frame => frame.type)).toEqual(['start', 'chunk', 'chunk', 'end'])
    const [start, first, second, end] = frames
    if (start?.type !== 'start' || first?.type !== 'chunk' || second?.type !== 'chunk' || end?.type !== 'end') {
      throw new Error('unreachable: frame types asserted above')
    }
    expect(first.index).toBe(0)
    expect(second.index).toBe(1)
    expect(end.index).toBe(2)
    expect(end.outcome).toEqual({ kind: 'committed', eventType: 'assistant/message', seq: 2 })
    expect(String(start.attemptId)).toBe('rc2-attempt-1')
    expect(frames.every(frame => String(frame.attemptId) === String(start.attemptId))).toBe(true)
    expect(frames.map(frame => frame.revision)).toEqual([...frames.map(frame => frame.revision)].sort((a, b) => a - b))
    const abandoned = modernAssistantStreamFrames({ outcome: { kind: 'abandoned' } }).at(-1)
    expect(abandoned?.type === 'end' ? abandoned.outcome : undefined).toEqual({ kind: 'abandoned' })
  })
})
