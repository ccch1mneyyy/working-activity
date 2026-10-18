/**
 * Durable `SessionEvent` → {@link ActivityEvent} normalization.
 *
 * Every host-shape guess for the durable log lives here (plus
 * `./tool-result.ts` for the tool-result payload), so a host-line change stays
 * a one-file fix and the state machine keeps consuming meaning only.
 *
 * Measured on the DSH `0.1.7-rc.2` and `0.2.x` lines: `assistant/chunk` no
 * longer exists in `SessionEventMap` or in `KNOWN_SESSION_EVENT_TYPES` (live
 * deltas arrive as transient `agent/assistant-stream` frames instead), so the
 * mapping below is the legacy path kept for replaying older logs. It must stay:
 * sessions written by pre-0.1.5 hosts still carry those events, and replaying
 * them is the only way a resuming user sees the same line they saw live.
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
  // `assistant/attempt` exists on the 0.1.5+ host lines only. The main build
  // compiles against `0.2.1-rc.2`, but the published package still runs on older
  // session maps; comparing widened strings keeps one adapter serving them all.
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
    // by the session controller's module merge, so it is absent from older
    // `SessionEventMap` copies — compared as a widened string for the same
    // reason `assistant/attempt` is.
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
  // The stall vocabulary (0.1.7-rc.2+ `KNOWN_SESSION_EVENT_TYPES`; widened
  // strings because older `SessionEventMap` copies predate them). Without these
  // the line cannot tell "waiting on the model" from "the model is waiting on
  // YOU".
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
  if (eventType === 'request/context') {
    const window = (event.data as { contextWindow?: unknown }).contextWindow
    if (typeof window !== 'number' || !Number.isFinite(window) || window <= 0) return []
    return [{ kind: 'context-window', at: event.time, window }]
  }
  if (eventType === 'todo/write') {
    const todos = (event.data as { todos?: unknown }).todos
    if (!Array.isArray(todos)) return []
    let done = 0
    let inProgress = 0
    for (const item of todos) {
      const status = asRecord(item)?.status
      if (status === 'completed') done += 1
      else if (status === 'in_progress') inProgress += 1
    }
    return [{
      kind: 'todo-write',
      at: event.time,
      counts: { done, total: todos.length, inProgress },
    }]
  }
  if (eventType === 'job/registered') {
    const data = event.data as {
      jobId?: unknown
      kind?: unknown
      label?: unknown
      startedAt?: unknown
    }
    const id = asString(data.jobId)
    if (id === undefined) return []
    return [{
      kind: 'job-start',
      at: event.time,
      job: {
        id,
        kind: asString(data.kind) ?? 'job',
        label: asString(data.label) ?? '',
        startedAt: finiteNumber(data.startedAt) ?? event.time,
      },
    }]
  }
  if (eventType === 'job/settled') {
    const id = asString((event.data as { jobId?: unknown }).jobId)
    return id === undefined ? [] : [{ kind: 'job-end', at: event.time, jobId: id }]
  }
  if (eventType === 'subagent/catalog') {
    const data = event.data as { childId?: unknown; mode?: unknown; label?: unknown }
    const id = asString(data.childId)
    if (id === undefined) return []
    const label = asString(data.label)
    return [{
      kind: 'subagent-catalog',
      at: event.time,
      subagent: {
        id,
        mode: asString(data.mode) ?? 'unknown',
        ...(label === undefined ? {} : { label }),
      },
    }]
  }
  if (eventType === 'team/member') {
    const member = asRecord((event.data as { member?: unknown }).member)
    const id = asString(member?.id)
    const phase = member?.phase
    if (id === undefined || (phase !== 'provisioning' && phase !== 'active' && phase !== 'failed')) return []
    return [{
      kind: 'team-member',
      at: event.time,
      member: { id, name: asString(member?.name) ?? id, phase },
    }]
  }
  if (eventType === 'team/task') {
    const task = asRecord((event.data as { task?: unknown }).task)
    const id = asString(task?.id)
    const status = task?.status
    if (id === undefined
      || (status !== 'pending' && status !== 'in_progress' && status !== 'completed' && status !== 'deleted')) return []
    return [{
      kind: 'team-task',
      at: event.time,
      task: {
        id,
        status,
        subject: asString(task?.subject) ?? '',
      },
    }]
  }
  if (eventType === 'goal/change') {
    const data = event.data as { operation?: unknown; goal?: unknown; roundsStarted?: unknown }
    if (data.operation === 'clear') return [{ kind: 'goal-change', at: event.time }]
    const goal = asRecord(data.goal)
    const phase = goal?.phase
    if (phase !== 'active' && phase !== 'paused' && phase !== 'blocked' && phase !== 'complete') return []
    const rounds = finiteNumber(data.roundsStarted) ?? 0
    const maxRounds = finiteNumber(goal?.maxGoalRounds) ?? 0
    return [{
      kind: 'goal-change',
      at: event.time,
      goal: { phase, rounds: Math.max(0, rounds), maxRounds: Math.max(0, maxRounds) },
    }]
  }
  if (eventType === 'agent/inbox/spliced') {
    const data = event.data as { target?: unknown; removedCount?: unknown; inserted?: unknown }
    const target = data.target
    if (target !== 'next-turn' && target !== 'next-step') return []
    const inserted = Array.isArray(data.inserted) ? data.inserted.length : 0
    const removed = finiteNumber(data.removedCount) ?? 0
    const delta = inserted - removed
    return delta === 0 ? [] : [{ kind: 'queue-change', at: event.time, target, delta }]
  }
  if (eventType === 'plan/mode') {
    const active = (event.data as { active?: unknown }).active
    return typeof active === 'boolean' ? [{ kind: 'plan-mode', at: event.time, plan: { active } }] : []
  }
  if (eventType === 'assistant/chunk') {
    // The pre-0.1.5 durable stream. `assistant/chunk` is absent from the
    // 0.2.x `SessionEventMap` the main build compiles against, so it is
    // read structurally (widened string) instead of as a `case`: a literal case
    // would be a TS2678 error here and a TS2367 error on the rc.6 corridor.
    // Old logs still replay through this path.
    const chunk = (event.data as { chunk?: { type?: unknown; text?: unknown } }).chunk
    if (chunk === undefined) return []
    // Only text and reasoning deltas carry displayable model output; the other
    // chunk kinds (usage, finish, block boundaries, tool-call deltas) never
    // reached the tracker's state even when this event was live.
    if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return []
    if (typeof chunk.text !== 'string' || chunk.text.length === 0) return []
    return [{
      kind: 'stream-delta',
      at: event.time,
      stream: chunk.type === 'text-delta' ? 'text' : 'reasoning',
      text: chunk.text,
    }]
  }
  switch (event.type) {
    case 'turn/start':
      return [{ kind: 'turn-start', at: event.time }]
    case 'step/start':
      return [{ kind: 'step-start', at: event.time }]
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


/** Narrow `unknown` to a plain record: objects only, never `null`, never an array. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** A non-empty string, or undefined for every other shape. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** A finite number, or undefined for every other shape. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
