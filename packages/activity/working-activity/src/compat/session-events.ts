/**
 * Durable `SessionEvent` → {@link ActivityEvent} normalization.
 *
 * Every host-shape guess for the durable log lives here (plus
 * `./tool-result.ts` for the tool-result payload), so a host-line change stays
 * a one-file fix and the state machine keeps consuming meaning only.
 *
 * Measured on the DSH `0.1.7-rc.2` line: `assistant/chunk` no longer exists in
 * `SessionEventMap` or in `KNOWN_SESSION_EVENT_TYPES` (live deltas arrive as
 * transient `agent/assistant-stream` frames instead), so the mapping below is
 * the legacy path kept for replaying older logs. It must stay: sessions
 * written by pre-0.1.5 hosts still carry those events, and replaying them is
 * the only way a resuming user sees the same line they would have seen live.
 * @module @deepseek-ai/dsh-working-activity/compat/session-events
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ActivityEvent, ActivityUsage } from '../activity-event.js'
import { resultCallId, resultFailed } from './tool-result.js'

/** Turn-end reason kinds that mean "the user stopped this turn". */
const INTERRUPTED_REASONS: readonly string[] = ['aborted', 'interrupted']

/**
 * Normalize one durable session event.
 *
 * Returns zero events for anything the tracker does not model (including a
 * tool result whose call id cannot be resolved — an unpaired result is
 * dropped, never guessed at).
 * @param event - Raw durable session event.
 * @returns the domain events this host event carries, in order.
 */
export function toActivityEvents(event: SessionEvent): readonly ActivityEvent[] {
  // `assistant/attempt` exists on the 0.1.5+ host lines only, and this package
  // still compiles against `@deepseek-ai/dsh-session@0.1.0-rc.6`, where the
  // member is absent from `SessionEventMap` — a literal `case` for it would not
  // typecheck there (TS2367, no overlap). Comparing the widened string keeps one
  // adapter serving every corridor.
  const eventType: string = event.type
  if (eventType === 'assistant/attempt') {
    // A PARTIAL settlement: the durable text may be shorter than what was
    // streamed, so provisional narration must go. The live `end` frame reports
    // the same outcome; folding the durable event too keeps replay of logs
    // written before (or without) frames correct. This is not an abandonment.
    return [{ kind: 'stream-reset', at: event.time, reason: 'attempt-settled' }]
  }
  if (eventType === 'model/selection') {
    // The selection the host validated for subsequent prompt assembly. Declared
    // by the session controller's module merge, so it is absent from the
    // rc.6-era `SessionEventMap` this package compiles against — compared as a
    // widened string for the same reason `assistant/attempt` is.
    //
    // A selection without a usable model id says nothing about the route, and
    // the tracker deduplicates repeats, so every selection is forwarded here.
    const model = (event.data as { model?: unknown }).model
    if (typeof model !== 'string' || model === '') return []
    return [{ kind: 'route-change', at: event.time, model }]
  }
  if (eventType === 'user/message') {
    // A compaction replaces the context with a checkpoint message; its source
    // kind is the durable marker. The source carries no overflow flag (only the
    // compaction id and the initiating command), so a finished compaction is
    // all this signal can prove.
    const source = (event.data as { message?: { source?: { kind?: unknown } } }).message?.source
    if (source?.kind !== 'compact-checkpoint') return []
    return [{ kind: 'compaction', at: event.time }]
  }
  // The stall vocabulary (0.1.7-rc.2 `KNOWN_SESSION_EVENT_TYPES`; widened
  // strings because the rc.6-era `SessionEventMap` this package compiles
  // against predates them). Without these the line cannot tell "waiting on the
  // model" from "the model is waiting on YOU".
  if (eventType === 'llm/retry' || eventType === 'llm/retry-started') {
    // The provider pushed back (rate limit / transient error); the host backs
    // off before another attempt.
    return [{ kind: 'waiting-reason', at: event.time, reason: 'retry' }]
  }
  if (eventType === 'approval/asked') {
    // A tool is parked on the user's decision.
    return [{ kind: 'waiting-reason', at: event.time, reason: 'approval' }]
  }
  if (eventType === 'approval/decided') {
    return [{ kind: 'waiting-cleared', at: event.time }]
  }
  if (eventType === 'compaction/start') {
    return [{ kind: 'waiting-reason', at: event.time, reason: 'compaction' }]
  }
  switch (event.type) {
    case 'turn/start':
      return [{ kind: 'turn-start', at: event.time }]
    case 'step/start':
      return [{ kind: 'step-start', at: event.time }]
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      // Only text and reasoning deltas carry displayable model output; the
      // other chunk kinds (usage, finish, block boundaries, tool-call deltas)
      // never reached the tracker's state even when this event was live.
      if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return []
      if (chunk.text.length === 0) return []
      return [{
        kind: 'stream-delta',
        at: event.time,
        stream: chunk.type === 'text-delta' ? 'text' : 'reasoning',
        text: chunk.text,
      }]
    }
    case 'assistant/message': {
      const usage = event.data.usage
      const normalized = usage === undefined ? undefined : normalizeUsage(usage)
      const text = settledText(event.data.message)
      return [{
        kind: 'assistant-settled',
        at: event.time,
        ...(normalized === undefined ? {} : { usage: normalized }),
        ...(text === '' ? {} : { text }),
      }]
    }
    case 'tool/call':
      return [{
        kind: 'tool-start',
        at: event.time,
        callId: event.data.callId,
        name: event.data.name,
        arguments: event.data.arguments,
      }]
    case 'tool/result': {
      const callId = resultCallId(event)
      if (callId === undefined) return []
      return [{ kind: 'tool-end', at: event.time, callId, failed: resultFailed(event) }]
    }
    case 'turn/end': {
      const reason = event.data.reason as { kind?: unknown } | undefined
      const interrupted = typeof reason?.kind === 'string' && INTERRUPTED_REASONS.includes(reason.kind)
      return [{ kind: 'turn-end', at: event.time, interrupted }]
    }
    default:
      return []
  }
}

/**
 * Feed one durable session event into any domain-event consumer.
 *
 * Kept as a free function so the tracker itself never learns a host type: the
 * published `onSessionEvent` method delegates here.
 * @param tracker - Consumer of normalized events.
 * @param event - Raw durable session event.
 */
export function feedSessionEvent(
  tracker: { onEvent(event: ActivityEvent): void },
  event: SessionEvent,
): void {
  for (const activityEvent of toActivityEvents(event)) tracker.onEvent(activityEvent)
}

/** Copy the host's usage counters into the plugin's own shape. */
function normalizeUsage(usage: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): ActivityUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
  }
}

/**
 * The text of a settled assistant message, concatenated from its text blocks.
 *
 * Structural readers only: the message shape is host data, and a message with a
 * different shape yields '' rather than throwing (the tracker then simply has no
 * narration for it).
 * @param message - The event's message payload, of unknown shape.
 * @returns the message text, or '' when it carries none.
 */
function settledText(message: unknown): string {
  if (message === null || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record.type !== 'text' || typeof record.text !== 'string') continue
    text += record.text
  }
  return text
}
