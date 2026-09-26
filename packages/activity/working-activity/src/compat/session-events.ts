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
      return [{ kind: 'assistant-settled', at: event.time, ...(normalized === undefined ? {} : { usage: normalized }) }]
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
