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
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.systemPrompt for the narration section injection.
import type {} from '@deepseek-ai/dsh-system-prompt'
import { ActivityTracker } from './status.js'
import { feedStreamFrame } from './compat/assistant-stream.js'
import { registerActivityEventType } from './registration.js'
import { setLangOverride, t } from './lang.js'
import { DEFAULT_PRESET } from './frames.js'
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
  /** UI language: `auto` follows `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` →
   *  OS locale → zh; `zh`/`en` pin the copy directly. */
  lang?: 'auto' | 'zh' | 'en'
  /** Default frame preset name (informational for UI consumers; the TUI
   *  resolves the persisted `frames` choice itself). */
  frames?: string
  /** lively: full flourish (default) / minimal: functional labels only. */
  mode?: 'lively' | 'minimal'
  /** Per-feature switches; explicit values override `mode` defaults. */
  features?: Record<string, boolean>
  /** Extra thinking phrases appended to the base pool. */
  customPhrases?: string[]
  /** Show an estimated tokens/s prefix while streaming. */
  showTokPerSec?: boolean
  /** Work reminder after this many turn-hours (0 = off). */
  workRemindAt?: number
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
  lang: z.union(['auto', 'zh', 'en']).default('auto'),
  frames: z.string().default(DEFAULT_PRESET),
  mode: z.union(['lively', 'minimal']).default('lively'),
  features: z.dict(z.boolean()).default({}),
  customPhrases: z.array(z.string()).default([]),
  showTokPerSec: z.boolean().default(false),
  workRemindAt: z.number().min(0).max(24).default(0),
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
  lang: 'auto' | 'zh' | 'en'
  frames: string
  mode: 'lively' | 'minimal'
  features: Record<string, boolean>
  customPhrases: string[]
  showTokPerSec: boolean
  workRemindAt: number
}

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
    // `mode: minimal` renders functional labels only (pi extension parity).
    phrases: config.phrases ?? config.mode !== 'minimal',
    publish: config.publish ?? false,
    tickMs: config.tickMs ?? 500,
    publishIntervalMs: config.publishIntervalMs ?? 2000,
    detailLimit: config.detailLimit ?? 40,
    narrate: config.narrate ?? true,
    lang: config.lang ?? 'auto',
    customActions: config.customActions ?? {},
    frames: config.frames ?? DEFAULT_PRESET,
    mode: config.mode ?? 'lively',
    features: config.features ?? {},
    customPhrases: config.customPhrases ?? [],
    showTokPerSec: config.showTokPerSec ?? false,
    workRemindAt: config.workRemindAt ?? 0,
  }
  // A pinned plugin-level language beats the env/file chain; releasing it on
  // dispose restores `auto` for any other composition in the process.
  setLangOverride(resolved.lang)
  ctx.effect(() => () => setLangOverride('auto'), 'working-activity lang override')
  /**
   * One session's live activity state.
   *
   * Every session owns its tracker, its pending wake-up and its publish
   * throttle. A single shared "active session" made the line of a session that
   * stopped emitting events freeze entirely (only the last session to emit was
   * ever redrawn), and made two concurrent sessions — a background session and
   * the one on screen, say — consume each other's throttle state.
   */
  interface SessionRuntime {
    readonly session: Session
    readonly tracker: ActivityTracker
    timer?: NodeJS.Timeout
    lastPublishedLine?: string
    lastPublishedPhase?: string
    lastPublishAt: number
  }

  const runtimes = new Map<Session, SessionRuntime>()
  /**
   * The session whose line currently owns the single TUI prompt slot. The slot
   * is one global seat with no notion of a foreground session, so the
   * most-recently-active session keeps it; the per-session event log above is
   * unaffected by this choice.
   */
  let slotSession: Session | undefined

  // Optional TUI seam: no TUI composed -> no slot, no error. The register()
  // call is itself effect-owned, so fiber disposal unregisters the slot.
  const prompt = ctx.get('tuiPrompt', false) as TuiPromptLike | undefined
  const promptHandle = prompt?.register('activity', undefined)

  // The `⏵` self-narration contract rides the stable system-prompt sections:
  // injected when the systemPrompt service is composed (agent assemblies
  // always mount it), removed with this fiber. The text is resolved at every
  // assembly in the live language, so a `/lang` switch applies to the next
  // turn without rebuilding the agent.
  if (resolved.narrate) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: 'working-activity:narrate',
        order: 60,
        text: () => t('narrate-instruction'),
      })
    })
  }

  const runtimeFor = (session: Session): SessionRuntime => {
    let runtime = runtimes.get(session)
    if (runtime === undefined) {
      runtime = {
        session,
        tracker: new ActivityTracker(
          {
            phrases: resolved.phrases,
            detailLimit: resolved.detailLimit,
            showIdle: false,
            features: resolved.features,
            customPhrases: resolved.customPhrases,
            showTokPerSec: resolved.showTokPerSec,
            workRemindAt: resolved.workRemindAt,
          },
          Date.now,
          resolved.customActions,
        ),
        lastPublishAt: 0,
      }
      runtimes.set(session, runtime)
    }
    return runtime
  }

  /** Stop one runtime's pending wake-up. */
  const stopTimer = (runtime: SessionRuntime): void => {
    if (runtime.timer === undefined) return
    clearTimeout(runtime.timer)
    runtime.timer = undefined
  }

  /**
   * Arm the next redraw, if this line has one coming.
   *
   * The tracker knows when its own line can next change (`nextWakeAt`), so an
   * idle or settled line arms nothing at all — the idle CPU of a permanent
   * 500 ms interval is what issue #14 reported. Live phases are additionally
   * capped at the configured tick so a wrong estimate can only make the line
   * fresher, never staler.
   */
  const armTimer = (runtime: SessionRuntime): void => {
    stopTimer(runtime)
    const nowMs = Date.now()
    const wakeAt = runtime.tracker.nextWakeAt(nowMs)
    if (wakeAt === undefined) return
    const phase = runtime.tracker.render(nowMs).phase
    const live = phase !== 'idle' && phase !== 'done'
    const delayMs = Math.max(0, live ? Math.min(wakeAt - nowMs, resolved.tickMs) : wakeAt - nowMs)
    runtime.timer = setTimeout(() => {
      runtime.timer = undefined
      publish(runtime, runtime.tracker.render())
      armTimer(runtime)
    }, delayMs)
    // A status line must never be the reason a process stays alive.
    runtime.timer.unref()
  }

  /**
   * Feed one runtime and republish. Callers snapshot the tracker state at event
   * time and hand it here, so a burst of fast events (e.g. a synchronous tool
   * call+result) cannot lose an intermediate phase; the append itself runs
   * inside a microtask because the session's appending guard is still set while
   * session/event callbacks run.
   */
  const feed = (runtime: SessionRuntime, state: ActivityState): void => {
    slotSession = runtime.session
    publish(runtime, state)
    // A pending wake-up will refresh the line soon enough; re-arming on every
    // streamed token would churn timers at the token rate.
    if (runtime.timer === undefined) armTimer(runtime)
  }

  /** Publish one rendered snapshot: TUI slot update + throttled session event. */
  const publish = (runtime: SessionRuntime, state: ActivityState): void => {
    queueMicrotask(() => {
      const line = state.phase === 'idle' ? undefined : state.line
      if (runtime.session === slotSession) promptHandle?.set(line)
      if (!resolved.publish) return
      const nowMs = Date.now()
      const lineChanged = state.line !== runtime.lastPublishedLine
      const phaseChanged = state.phase !== runtime.lastPublishedPhase
      // Live phases republish on a throttle so elapsed times stay current;
      // settled phases (idle/done) publish only when the line itself changes.
      const liveThrottle = state.phase !== 'idle' && state.phase !== 'done'
        && nowMs - runtime.lastPublishAt >= resolved.publishIntervalMs
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
        runtime.session.append('activity/status', payload)
        runtime.lastPublishedLine = state.line
        runtime.lastPublishedPhase = state.phase
        runtime.lastPublishAt = nowMs
      } catch {
        // Session closed or the append guard still held: drop this snapshot;
        // the next wake retries the same line.
      }
    })
  }

  ctx.on('session/event', (session, event) => {
    const runtime = runtimeFor(session)
    runtime.tracker.onSessionEvent(event)
    feed(runtime, runtime.tracker.render())
  })

  // Live model output. On the current host line the durable `assistant/chunk`
  // event this plugin used to fold is gone — streamed deltas arrive as
  // transient `agent/assistant-stream` frames instead — so the realtime half of
  // the line (first-token promotion, `⏵` narration, tok/s) rides on these
  // frames. Subscribed through a cast because the declared dev baseline
  // (`@deepseek-ai/dsh-agent@0.1.0-rc.6`) predates the event; on that corridor
  // the subscription simply never fires and the durable path above still runs.
  // The cursor that orders frames lives with the emitting agent, so a replaced
  // agent (whose revision restarts at 1) is never mistaken for a stale one.
  ctx.on('agent/assistant-stream' as never, (({ agent, frame }: { agent: Agent; frame: unknown }) => {
    const runtime = runtimeFor(agent.session)
    feedStreamFrame(runtime.tracker, agent, frame)
    feed(runtime, runtime.tracker.render())
  }) as never)

  ctx.on('session/disposed', (session) => {
    const runtime = runtimes.get(session)
    if (runtime !== undefined) stopTimer(runtime)
    runtimes.delete(session)
    if (slotSession === session) slotSession = undefined
  })

  ctx.on('agent/status', ({ agent, status }) => {
    const runtime = runtimeFor(agent.session)
    runtime.tracker.onAgentStatus(status)
    feed(runtime, runtime.tracker.render())
  })

  // No interval: each session's next redraw is armed from its own tracker
  // (`nextWakeAt`), so idle and settled lines hold no timer at all. The effect
  // disposer stops every pending wake-up when this fiber unloads.
  ctx.effect(() => () => {
    for (const runtime of runtimes.values()) stopTimer(runtime)
  }, 'working-activity session timers')
}
