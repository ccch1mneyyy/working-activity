/**
 * Client-side activity snapshot type + the ConversationSnapshot merge that
 * carries it.
 *
 * The host half (@deepseek-ai/dsh-working-activity's node side) publishes
 * `activity/status` session events; the web runtime patch (dsh-client-runtime
 * activity field, shipping separately) narrows those frames into the
 * conversation snapshot's `activity` member. Until that runtime release lands
 * on npm, this module re-declares the field via declaration merging so the
 * dock component type-checks against the published rc.6 types.
 *
 * REMOVE the `declare module` block below once
 * `@deepseek-ai/dsh-client-runtime/client` ships `ConversationSnapshot.activity`
 * natively (the runtime's own `ActivityStatusView` is structurally identical
 * to {@link ActivitySnapshot}; the two then agree by construction).
 * @module @deepseek-ai/dsh-working-activity/client/activity
 */

/** The `activity/status` phase vocabulary, mirroring the host's ActivityPhase. */
export type ActivityPhase = 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'

/** One `activity/status` snapshot as rendered by the dock line. */
export interface ActivitySnapshot {
  /** Which activity phase the model is in right now. */
  readonly phase: ActivityPhase
  /** Full human-readable status line (plain text, no ANSI). */
  readonly line: string
  /** Short label of the current work (tool action or stage), when any. */
  readonly label?: string
  /** Detail fragment (path / command / search pattern), when any. */
  readonly detail?: string
  /** The playful phrase currently shown, when any. */
  readonly phrase?: string
  /** Tools completed in the current turn. */
  readonly toolCount: number
  /** Wall-clock milliseconds since the current turn started (0 when idle). */
  readonly turnElapsedMs: number
  /** Wall-clock time the current phase started, for animations. */
  readonly phaseStartedAt: number
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationSnapshot {
    /**
     * Latest validated `activity/status` snapshot (the working-activity
     * plugin's live working line), or null before the first publish.
     */
    activity: ActivitySnapshot | null
  }
}
