/**
 * `activity/status` session event — a log-only, non-surface snapshot of the
 * model's current working activity, published by this plugin for any UI
 * consumer (Web client, telemetry, …). It never enters derived model history
 * (no `surfaceOp`), so it cannot leak into prompts; UIs render it like
 * `todo/write` or `plan/mode`.
 * @module @deepseek-ai/dsh-working-activity/events
 */

import type { ActivityPhase } from './status.js'

/** Durable payload of one `activity/status` snapshot. */
export interface ActivityStatusEvent {
  /** Which activity phase the model is in. */
  readonly phase: ActivityPhase
  /** Human-readable status line (plain text, no ANSI). */
  readonly line: string
  /** Short label of the current work, when any. */
  readonly label?: string
  /** Detail fragment (path / command / pattern), when any. */
  readonly detail?: string
  /** The playful phrase currently shown, when the copy pool is on. */
  readonly phrase?: string
  /** Tools completed in the current turn. */
  readonly toolCount: number
  /** Milliseconds since the current turn started (0 when idle). */
  readonly turnElapsedMs: number
  /** Wall-clock time (epoch ms) the current phase started, for animations. */
  readonly phaseStartedAt: number
}

/** The `activity/status` phase vocabulary, exported for wire consumers. */
export type { ActivityPhase }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Legacy log-only UI snapshot (pre-0.6 publishing path). Kept declared so
     * old logs still typecheck and replay; new writes use the plugin-record
     * name below on hosts that support it.
     * @param data - The rendered status snapshot.
     */
    'activity/status': ActivityStatusEvent
  }
  interface PluginRecordMap {
    /**
     * Current log-only UI snapshot, written with `appendPluginRecord()` so the
     * reader admits it as an ignorable record instead of refusing the session.
     * Never a surface event: UIs render it, the model never sees it.
     * @param data - The rendered status snapshot.
     */
    'plugin:working-activity/status': ActivityStatusEvent
  }
}
