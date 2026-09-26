/**
 * Live `agent/assistant-stream` frame → {@link ActivityEvent} normalization.
 *
 * This is the realtime half of the plugin's input. On the current host line the
 * durable `assistant/chunk` event no longer exists (it is absent from
 * `SessionEventMap` and from `KNOWN_SESSION_EVENT_TYPES`) and streamed output
 * arrives as transient frames published on the agent scope instead, so without
 * this module the line has no first-token promotion, no `⏵` narration and no
 * tok/s estimate — it only moves when durable tool events arrive.
 *
 * Measured frame shape (`@deepseek-ai/dsh-agent@0.1.7-rc.2`,
 * `lib/types/runtime-types.d.ts`):
 *
 * ```text
 * start { attemptId, revision, turn, step }
 * chunk { attemptId, revision, index, time, chunk }   chunk: StreamChunk
 * end   { attemptId, revision, index, outcome }       outcome: committed{eventType,seq} | abandoned
 * ```
 *
 * The fields stay read tolerantly rather than through a host type import: the
 * package still compiles against `@deepseek-ai/dsh-agent@0.1.0-rc.6`, which has
 * no `AssistantStreamFrame` declaration at all. Reading structurally is also
 * what keeps the next reshape a one-file fix here.
 *
 * ## Why the cursor is keyed by the agent, not by the session
 * `revision` is documented as "monotone within one attached Agent lifecycle;
 * replacement restarts at 1". A single counter would therefore drop every frame
 * of a replacement agent (`1 <= 100`) and silence the line forever, so the
 * cursor lives in a `WeakMap` keyed by the emitting agent — a new agent is a new
 * key and starts at its own revision 1 with no explicit reset anywhere.
 * @module @deepseek-ai/dsh-working-activity/compat/assistant-stream
 */

import type { ActivityEvent, ActivityStreamKind } from '../activity-event.js'

/** Identity of one agent lifecycle. Frames of different owners never share a cursor. */
export type StreamOwner = object

/** Frame types this adapter understands. */
const FRAME_TYPES: readonly string[] = ['start', 'chunk', 'end']

/** Per-owner live-stream cursor, dropped with the owner. */
interface StreamCursor {
  /** Highest accepted revision; `undefined` until a revision-carrying frame arrives. */
  revision?: number
  /** Attempt currently streaming, when one was opened or adopted. */
  attemptId?: string
}

const cursors = new WeakMap<StreamOwner, StreamCursor>()

/** The cursor for one agent lifecycle, created on first use. */
function cursorFor(owner: StreamOwner): StreamCursor {
  let cursor = cursors.get(owner)
  if (cursor === undefined) {
    cursor = {}
    cursors.set(owner, cursor)
  }
  return cursor
}

/**
 * Whether one frame is new for its owner's cursor, updating the cursor.
 *
 * Ordering is enforced only when both sides carry a usable revision: a host
 * that stops timestamping frames must degrade to "accept" rather than "drop
 * everything", because a silently frozen line is the exact failure this module
 * exists to prevent. Duplicate delivery in that degraded mode costs a repeated
 * delta, which the narration buffer tolerates.
 */
function accept(cursor: StreamCursor, revision: unknown): boolean {
  if (typeof revision !== 'number' || !Number.isFinite(revision)) return true
  if (cursor.revision !== undefined && revision <= cursor.revision) return false
  cursor.revision = revision
  return true
}

/** Narrow `unknown` to a plain record: objects only, never `null`, never an array. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** A usable attempt id: a non-empty string, returned verbatim. */
function asAttemptId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/** A frame timestamp, falling back to the wall clock when the host omits one. */
function frameTime(frame: Record<string, unknown>): number {
  const time = frame.time
  return typeof time === 'number' && Number.isFinite(time) ? time : Date.now()
}

/**
 * Normalize one live frame for the agent that published it.
 *
 * Returns zero events for anything the tracker does not model: unknown frame
 * types, non-delta chunks (block boundaries, tool-call deltas, usage, finish),
 * empty delta text, and any frame the owner's revision cursor has already seen.
 *
 * @param owner - The agent lifecycle that published the frame (cursor key).
 * @param frame - Raw `agent/assistant-stream` frame, or any host payload.
 * @returns the domain events this frame carries, in order.
 */
export function frameToActivityEvents(owner: StreamOwner, frame: unknown): readonly ActivityEvent[] {
  const record = asRecord(frame)
  if (record === undefined) return []
  const type = typeof record.type === 'string' ? record.type : undefined
  if (type === undefined || !FRAME_TYPES.includes(type)) return []

  const cursor = cursorFor(owner)
  if (!accept(cursor, record.revision)) return []

  if (type === 'start') {
    const attemptId = asAttemptId(record.attemptId)
    cursor.attemptId = attemptId
    return [{
      kind: 'stream-start',
      at: frameTime(record),
      ...(attemptId === undefined ? {} : { attemptId }),
    }]
  }

  if (type === 'chunk') return chunkEvents(cursor, record)

  return endEvents(cursor, record)
}

/**
 * One `chunk` frame: open the attempt first when the frame announces one the
 * cursor has not seen, then the delta itself.
 *
 * Adoption matters after a reattach/resume, where the stream is joined
 * mid-attempt and no `start` frame is redelivered: the first chunk a plugin
 * sees would otherwise be unusable. Safety comes from the revision cursor
 * instead — a late chunk of a superseded attempt carries a lower revision and
 * never reaches this point.
 */
function chunkEvents(cursor: StreamCursor, frame: Record<string, unknown>): readonly ActivityEvent[] {
  const at = frameTime(frame)
  const attempts = asAttemptId(frame.attemptId)
  const events: ActivityEvent[] = []
  if (attempts !== undefined && attempts !== cursor.attemptId) {
    cursor.attemptId = attempts
    events.push({ kind: 'stream-start', at, attemptId: attempts })
  }
  const chunk = asRecord(frame.chunk)
  const delta = deltaOf(chunk)
  if (delta !== undefined && delta.text.length > 0) {
    events.push({ kind: 'stream-delta', at, stream: delta.stream, text: delta.text })
  }
  return events
}

/**
 * One `end` frame. Both terminal outcomes clear the cursor's attempt, but only
 * the ones whose committed output can differ from what was streamed ask the
 * tracker to drop its provisional state:
 *
 * - `abandoned` — no settlement at all, so the provisional narration is wrong;
 * - `committed` + `assistant/attempt` — a PARTIAL settlement, so the streamed
 *   text may exceed what was committed. This is not an abandonment and is not
 *   reported as one;
 * - `committed` + `assistant/message` — the streamed text IS the committed
 *   message, so its narration may keep its freshness window (the durable
 *   settlement already carried the same content);
 * - an unrecognized outcome — cleared, but no reset event, so a future terminal
 *   kind cannot accidentally discard narration it did commit.
 */
function endEvents(cursor: StreamCursor, frame: Record<string, unknown>): readonly ActivityEvent[] {
  const at = frameTime(frame)
  cursor.attemptId = undefined
  const outcome = asRecord(frame.outcome)
  const kind = typeof outcome?.kind === 'string' ? outcome.kind : undefined
  if (kind === 'abandoned') return [{ kind: 'stream-reset', at, reason: 'abandoned' }]
  const eventType = typeof outcome?.eventType === 'string' ? outcome.eventType : undefined
  if (kind === 'committed' && eventType === 'assistant/attempt') {
    return [{ kind: 'stream-reset', at, reason: 'attempt-settled' }]
  }
  return []
}

/** The stream kind and text of one chunk, when it is a displayable delta. */
function deltaOf(chunk: Record<string, unknown> | undefined): { stream: ActivityStreamKind; text: string } | undefined {
  if (chunk === undefined) return undefined
  const text = chunk.text
  if (typeof text !== 'string') return undefined
  if (chunk.type === 'text-delta') return { stream: 'text', text }
  if (chunk.type === 'reasoning-delta') return { stream: 'reasoning', text }
  return undefined
}

/**
 * Feed one live frame into any domain-event consumer.
 *
 * Kept as a free function so the tracker never learns a host type: the plugin
 * subscribes to `agent/assistant-stream` and calls this.
 * @param tracker - Consumer of normalized events.
 * @param owner - The agent lifecycle that published the frame.
 * @param frame - Raw frame payload.
 */
export function feedStreamFrame(
  tracker: { onEvent(event: ActivityEvent): void },
  owner: StreamOwner,
  frame: unknown,
): void {
  for (const activityEvent of frameToActivityEvents(owner, frame)) tracker.onEvent(activityEvent)
}
