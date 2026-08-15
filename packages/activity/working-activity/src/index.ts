/**
 * working-activity — a live "working line" for DeepSeek Harness agents.
 *
 * Folds the durable session stream (turn/step/tool/stream events) plus
 * `agent/status` into a playful real-time status line, then publishes it two
 * ways, both optional:
 *
 * - TUI: registers the `${activity}` prompt slot on `ctx.tuiPrompt` when the
 *   TUI is composed; add `${activity}` to `theme.leftPrompt` to see it.
 * - Session log: appends log-only `activity/status` events (never surface
 *   events) for Web and other UI consumers; replay ignores them.
 *
 * The state machine itself lives in `./status.ts` (pure, clock-injected); this
 * module only wires events, the render tick, and the two sinks.
 * @module @deepseek-ai/dsh-working-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: resolves the agent/status cordis event declaration.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.systemPrompt for the narration section injection.
import type {} from '@deepseek-ai/dsh-system-prompt'
import { ActivityTracker } from './status.js'
import { registerActivityEventType } from './registration.js'
import type { ActivityState } from './status.js'
import type { ActivityStatusEvent } from './events.js'
// Re-export the event type + SessionEventMap merge: the package root must carry
// the declare-module side effect for consumers resolving the built d.ts.
export type * from './events.js'

export const name = 'working-activity'

/** Configurable knobs; every key has a sane default. */
export type Config = {
  /** Playful copy pool; false renders plain functional labels. */
  phrases?: boolean
  /** Append `activity/status` session events for UI consumers. Default OFF:
   *  dsh-session's append() cannot mark events ignorable, and the resume
   *  read path refuses logs containing unknown non-ignorable types — every
   *  appended snapshot makes the whole session unresumable. Re-enable only
   *  for a log-replaying consumer on a harness that supports ignorable
   *  appends. The live status line (prompt slot / session events) is
   *  unaffected by this flag. */
  publish?: boolean
  /** Status render tick interval in ms. */
  tickMs?: number
  /** Minimum interval in ms between published events while the line is stable. */
  publishIntervalMs?: number
  /** Maximum displayed detail length (paths/commands/patterns). */
  detailLimit?: number
  /** Exact tool-name → action-copy pools (case-insensitive match). */
  customActions?: Record<string, string[]>
  /** Inject the `⏵` self-narration contract into the system prompt and surface it. */
  narrate?: boolean
}

// Explicit annotation: the inferred z.dict output references cosmokit's
// Dict through a pnpm-virtual path, which is not portable in declaration
// emit (TS2883) when the dependency graph shifts. The global `Schemastery`
// interface comes from schemastery's own d.ts (declare global).
export const Config: Schemastery<Config> = z.object({
  phrases: z.boolean().default(true),
  publish: z.boolean().default(false),
  tickMs: z.number().step(50).min(100).max(5000).default(500),
  publishIntervalMs: z.number().step(500).min(500).max(30_000).default(2000),
  detailLimit: z.number().step(1).min(8).max(120).default(40),
  customActions: z.dict(z.array(z.string())).default({}),
  narrate: z.boolean().default(true),
})

/** Structural view of the TUI prompt service; the real type lives in dsh-tui. */
interface TuiPromptLike {
  register(name: string, initialValue?: string): {
    set(value: string | undefined): void
    dispose(): void
  }
}

/** Resolved plugin configuration after schema defaults. */
interface ResolvedConfig {
  phrases: boolean
  publish: boolean
  tickMs: number
  publishIntervalMs: number
  detailLimit: number
  customActions: Record<string, string[]>
  narrate: boolean
}

/** The self-narration contract injected into the system prompt (narrate on). */
const NARRATE_INSTRUCTION =
  '[状态栏] 你有一个状态栏展示给用户。【必须】在每个步骤/子任务开始时（不只是调用工具前），在回复正文的最前面单独写一行：⏵ 你在做的具体事情（不超过20字），然后换行继续正常回复。整轮回复只写一行 ⏵，不要重复。信息为主——让人一眼知道你在干什么，风格自然、可以带点俏皮。例：⏵ 修复登录页样式、⏵ 查一下报错原因、⏵ 给补丁跑个验证。切换任务时必须更新。'

/**
 * Wire the working-activity plugin.
 * @param ctx - Cordis context (agent loop + session services composed).
 * @param config - Validated plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Register the event type BEFORE anything can publish or validate: the
  // strict read paths (resume seed validation, persistence load) refuse
  // logs with unknown non-ignorable types. Registration is unconditional —
  // it also protects READING logs written by an earlier publish:true era
  // in processes where publishing itself is off. See registration.ts.
  registerActivityEventType()
  const resolved: ResolvedConfig = {
    phrases: config.phrases ?? true,
    publish: config.publish ?? false,
    tickMs: config.tickMs ?? 500,
    publishIntervalMs: config.publishIntervalMs ?? 2000,
    detailLimit: config.detailLimit ?? 40,
    narrate: config.narrate ?? true,
    customActions: config.customActions ?? {},
  }
  const trackers = new Map<Session, ActivityTracker>()
  let activeSession: Session | undefined
  let lastPublishedLine: string | undefined
  let lastPublishedPhase: string | undefined
  let lastPublishAt = 0

  // Optional TUI seam: no TUI composed -> no slot, no error. The register()
  // call is itself effect-owned, so fiber disposal unregisters the slot.
  const prompt = ctx.get('tuiPrompt', false) as TuiPromptLike | undefined
  const promptHandle = prompt?.register('activity', undefined)

  // The `⏵` self-narration contract rides the stable system-prompt sections:
  // injected when the systemPrompt service is composed (agent assemblies
  // always mount it), removed with this fiber.
  if (resolved.narrate) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: 'working-activity:narrate',
        order: 60,
        text: NARRATE_INSTRUCTION,
      })
    })
  }

  const trackerFor = (session: Session): ActivityTracker => {
    let tracker = trackers.get(session)
    if (tracker === undefined) {
      tracker = new ActivityTracker(
        { phrases: resolved.phrases, detailLimit: resolved.detailLimit, showIdle: false },
        Date.now,
        resolved.customActions,
      )
      trackers.set(session, tracker)
    }
    return tracker
  }

  /**
   * Publish one rendered snapshot: TUI slot update + throttled session event.
   * Callers snapshot the tracker state at event time and hand it here, so a
   * burst of fast events (e.g. a synchronous tool call+result) cannot lose an
   * intermediate phase; the append itself runs inside a microtask because the
   * session's appending guard is still set while session/event callbacks run.
   */
  const publish = (session: Session, state: ActivityState): void => {
    queueMicrotask(() => {
      const line = state.phase === 'idle' ? undefined : state.line
      promptHandle?.set(line)
      if (!resolved.publish) return
      const nowMs = Date.now()
      const lineChanged = state.line !== lastPublishedLine
      const phaseChanged = state.phase !== lastPublishedPhase
      // Live phases republish on a throttle so elapsed times stay current;
      // settled phases (idle/done) publish only when the line itself changes.
      const liveThrottle = state.phase !== 'idle' && state.phase !== 'done'
        && nowMs - lastPublishAt >= resolved.publishIntervalMs
      if (!lineChanged && !phaseChanged && !liveThrottle) return
      // Optional fields must be omitted (not undefined): session append rejects
      // data JSON would discard, and `activity/status` is a lossless-JSON event.
      const payload: ActivityStatusEvent = {
        phase: state.phase,
        line: state.line,
        toolCount: state.toolCount,
        turnElapsedMs: state.turnElapsedMs,
        phaseStartedAt: state.phaseStartedAt,
        ...(state.label === undefined ? {} : { label: state.label }),
        ...(state.detail === undefined ? {} : { detail: state.detail }),
        ...(state.phrase === undefined ? {} : { phrase: state.phrase }),
      }
      try {
        session.append('activity/status', payload)
        lastPublishedLine = state.line
        lastPublishedPhase = state.phase
        lastPublishAt = nowMs
      } catch {
        // Session closed or the append guard still held: drop this snapshot;
        // the next tick retries the same line.
      }
    })
  }

  ctx.on('session/event', (session, event) => {
    const tracker = trackerFor(session)
    tracker.onSessionEvent(event)
    activeSession = session
    publish(session, tracker.render())
  })

  ctx.on('session/disposed', (session) => {
    trackers.delete(session)
    if (activeSession === session) activeSession = undefined
  })

  ctx.on('agent/status', ({ agent, status }) => {
    const session = agent.session
    const tracker = trackerFor(session)
    tracker.onAgentStatus(status)
    activeSession = session
    publish(session, tracker.render())
  })

  // Continuous tick: elapsed times and the phrase rotation move on their own.
  // A manual timer keeps this plugin free of the @cordisjs/plugin-timer mixin;
  // the effect disposer clears it when this fiber unloads.
  const tickTimer = setInterval(() => {
    if (activeSession === undefined) return
    const tracker = trackers.get(activeSession)
    if (tracker === undefined) return
    publish(activeSession, tracker.render())
  }, resolved.tickMs)
  ctx.effect(() => () => { clearInterval(tickTimer) }, 'working-activity tick timer')
}
