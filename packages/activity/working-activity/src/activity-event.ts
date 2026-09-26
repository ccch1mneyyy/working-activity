/**
 * The tracker's own event vocabulary — the only input `ActivityTracker`
 * understands.
 *
 * Why this exists: the state machine used to consume raw DSH `SessionEvent`s,
 * so every host payload drift silently changed the rendered status (the
 * current host moved a tool-call id out of `content[]` and replaced the durable
 * `assistant/chunk` stream with transient frames — both broke the line without
 * a single failing test). Events here carry **meaning**, never host shape:
 * `kind` plus already-normalized values, and every one of them is timestamped
 * by the producer so the clock stays injectable.
 *
 * Producers live in `src/compat/*` (durable session events) and
 * `src/compat/assistant-stream.ts` (live attempt frames). The tracker must
 * never import a DSH type.
 * @module @deepseek-ai/dsh-working-activity/activity-event
 */

/** Token counters reported by one settled assistant message. */
export interface ActivityUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

/** Which stream a delta came from (reasoning and text both drive narration). */
export type ActivityStreamKind = 'text' | 'reasoning'

/**
 * Why provisional stream state was dropped: the attempt was abandoned (its
 * output will never be settled) or only a partial settlement was committed
 * (`assistant/attempt`). Both clear the buffer; they are not the same event.
 */
export type ActivityStreamResetReason = 'abandoned' | 'attempt-settled'

/** One normalized activity event. */
export type ActivityEvent =
  /** A new turn opened: per-turn counters reset, phase → waiting. */
  | { readonly kind: 'turn-start'; readonly at: number }
  /** A step opened. Carries no phase change on its own. */
  | { readonly kind: 'step-start'; readonly at: number }
  /** A live model attempt opened; later deltas belong to `attemptId`. */
  | { readonly kind: 'stream-start'; readonly at: number; readonly attemptId?: string }
  /** One streamed delta with non-empty text. */
  | {
    readonly kind: 'stream-delta'
    readonly at: number
    readonly stream: ActivityStreamKind
    readonly text: string
  }
  /** Drop provisional stream state for the attempt that just ended. */
  | { readonly kind: 'stream-reset'; readonly at: number; readonly reason: ActivityStreamResetReason }
  /** One assistant message settled with authoritative usage. */
  | { readonly kind: 'assistant-settled'; readonly at: number; readonly usage?: ActivityUsage }
  /** A tool started running. */
  | {
    readonly kind: 'tool-start'
    readonly at: number
    readonly callId: string
    readonly name: string
    readonly arguments: string
  }
  /** A tool settled; `callId` is the exact id its start carried. */
  | { readonly kind: 'tool-end'; readonly at: number; readonly callId: string; readonly failed: boolean }
  /** The model route changed to `model`. */
  | { readonly kind: 'route-change'; readonly at: number; readonly model: string }
  /** Context compaction finished, or overflowed while trying. */
  | { readonly kind: 'compaction'; readonly at: number; readonly overflow?: boolean }
  /** The agent entered another lifecycle status. */
  | { readonly kind: 'agent-status'; readonly at: number; readonly status: 'idle' | 'running' }
  /**
   * The turn closed. `interrupted` is already derived by the producer from the
   * host's reason vocabulary, so the tracker never learns those spellings.
   */
  | { readonly kind: 'turn-end'; readonly at: number; readonly interrupted?: boolean }
