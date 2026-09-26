/**
 * Wire fixtures for the DSH `0.1.7-rc.2` corridor.
 *
 * Two generations of the same durable records live here, and they must stay
 * unmixed: the **modern** `tool/result` moved the tool-call id out of the
 * content slot into `message.source.callId` (with a sibling
 * `message.toolCallId`), while the **legacy** shape carried it as
 * `message.content[0].toolCallId` and had no `source` at all. The assertions in
 * `integration.spec.ts` run over `keyPaths()` of every fixture so a later
 * "just support both" edit cannot quietly widen one generation into the other.
 *
 * `modernAssistantStreamFrames()` mirrors the transient
 * `agent/assistant-stream` frames of the current host; it is exported for the
 * commits that follow this one (the tracker has no frame entry point yet, so
 * nothing consumes it as an assertion input here).
 * @module dsh-working-activity-rc2-compat/fixtures
 */

import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import {
  LlmAttemptId,
  ToolCallId,
  createToolResultMessage,
  type StreamChunk,
  type ToolResultMessage,
} from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'

/** What one content array entry of a legacy tool-result message carried. */
export interface LegacyToolResultBlock {
  readonly type: 'tool-result'
  /** The call id the current host moved up to `message.source.callId`. */
  readonly toolCallId: string
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly isError?: boolean
}

/** Durable `tool/result` payload as the current host writes it. */
export interface ModernToolResultData {
  readonly turn: number
  readonly step: number
  readonly message: ToolResultMessage
}

/** Durable `tool/result` payload as the legacy host wrote it. */
export interface LegacyToolResultData {
  readonly turn: number
  readonly step: number
  readonly message: {
    readonly role: 'tool'
    readonly id: string
    readonly content: readonly LegacyToolResultBlock[]
    readonly isError?: boolean
  }
}

/** Either generation of a durable `tool/result` payload. */
export type ToolResultData = ModernToolResultData | LegacyToolResultData

/** Shared knobs for both generations of the tool-result fixture. */
export interface ToolResultOptions {
  readonly turn?: number
  readonly step?: number
  readonly isError?: boolean
}

/** The single text block both generations carry as the tool's own output. */
function textBlocks(text: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text }]
}

/**
 * Build one modern `tool/result` payload: the tool-call id lives on
 * `message.source.callId` and `message.toolCallId`, and `message.content`
 * holds only the tool's own result blocks.
 * @param callId - provider call id answered by this result.
 * @param text - the tool's result text.
 * @param options - turn/step placement and error flag.
 * @returns the durable event data the current host appends.
 */
export function modernToolResult(
  callId: string,
  text: string,
  options: ToolResultOptions = {},
): ModernToolResultData {
  const { turn = 1, step = 1, isError = false } = options
  return {
    turn,
    step,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content: textBlocks(text),
      isError,
    }),
  }
}

/**
 * Build one legacy `tool/result` payload: the tool-call id lives on
 * `message.content[0].toolCallId`; there is no `source` and no
 * `message.toolCallId`.
 * @param callId - provider call id answered by this result.
 * @param text - the tool's result text.
 * @param options - turn/step placement and error flag.
 * @returns the durable event data a pre-rc host appended.
 */
export function legacyToolResult(
  callId: string,
  text: string,
  options: ToolResultOptions = {},
): LegacyToolResultData {
  const { turn = 1, step = 1, isError = false } = options
  const id = `legacy-message-${callId}`
  return {
    turn,
    step,
    message: {
      role: 'tool',
      id,
      content: [{ type: 'tool-result', toolCallId: callId, content: textBlocks(text), isError }],
      isError,
    },
  }
}

/**
 * Wrap one fixture payload into the session event a tracker consumes.
 * @param data - either generation of the `tool/result` payload.
 * @param options - event time and sequence number.
 * @returns a `tool/result` session event.
 */
export function toolResultEvent(
  data: ToolResultData,
  options: { readonly time?: number; readonly seq?: number } = {},
): SessionEvent & { readonly type: 'tool/result' } {
  const { time = Date.now(), seq = 1 } = options
  return {
    type: 'tool/result',
    seq: SessionSeq(seq),
    time,
    data,
  } as unknown as SessionEvent & { readonly type: 'tool/result' }
}

/** How one attempt's transient stream ends. */
export type AssistantStreamOutcome =
  | { readonly kind: 'committed'; readonly eventType: 'assistant/message' | 'assistant/attempt'; readonly seq: number }
  | { readonly kind: 'abandoned' }

/** Knobs for {@link modernAssistantStreamFrames}. */
export interface AssistantStreamFrameOptions {
  readonly attemptId?: string
  readonly turn?: number
  readonly step?: number
  /** Revision of the opening frame; later frames increment it, as the host does. */
  readonly revision?: number
  /** Attempt-local start time; later frame times increment it by 1ms each. */
  readonly time?: number
  /** Chunk frames to publish in order; defaults to a single text delta. */
  readonly chunks?: readonly StreamChunk[]
  readonly outcome?: AssistantStreamOutcome
}

/**
 * Build the `start` / `chunk`* / `end` frames of one live model attempt on the
 * current host: dense zero-based chunk indexes, monotone revisions, and a
 * terminal outcome that is either a durable settlement or an abandonment.
 * @param options - attempt identity, placement, chunks, and terminal outcome.
 * @returns the frames in publication order.
 */
export function modernAssistantStreamFrames(
  options: AssistantStreamFrameOptions = {},
): AssistantStreamFrame[] {
  const {
    attemptId = 'rc2-attempt-1',
    turn = 1,
    step = 1,
    revision = 1,
    time = 1_700_000_000_000,
    chunks = [{ type: 'text-delta', index: 0, text: 'hello' }],
    outcome = { kind: 'committed', eventType: 'assistant/message', seq: 2 },
  } = options
  const id = LlmAttemptId(attemptId)
  const frames: AssistantStreamFrame[] = [
    { type: 'start', attemptId: id, revision, turn, step },
  ]
  chunks.forEach((chunk, index) => {
    frames.push({
      type: 'chunk',
      attemptId: id,
      revision: revision + 1 + index,
      index,
      time: time + 1 + index,
      chunk,
    })
  })
  frames.push({
    type: 'end',
    attemptId: id,
    revision: revision + 1 + chunks.length,
    index: chunks.length,
    outcome: outcome.kind === 'committed'
      ? { kind: 'committed', eventType: outcome.eventType, seq: SessionSeq(outcome.seq) }
      : { kind: 'abandoned' },
  })
  return frames
}

/**
 * Every key path reachable in a fixture value, array indices included
 * (`message.content[0].toolCallId`), with container paths listed alongside
 * their leaves so an empty container is still visible to an assertion.
 * @param value - fixture value to walk.
 * @param prefix - internal accumulator for the path built so far.
 * @returns dotted key paths, in traversal order.
 */
export function keyPaths(value: unknown, prefix = ''): string[] {
  const self = prefix === '' ? [] : [prefix]
  if (Array.isArray(value)) {
    return [...self, ...value.flatMap((entry, index) => keyPaths(entry, `${prefix}[${index}]`))]
  }
  if (value !== null && typeof value === 'object') {
    return [
      ...self,
      ...Object.entries(value as Record<string, unknown>)
        .flatMap(([key, entry]) => keyPaths(entry, prefix === '' ? key : `${prefix}.${key}`)),
    ]
  }
  return self
}

/** Whether a key path names a call id inside a `content` array (the legacy slot). */
export function isLegacyContentCallId(path: string): boolean {
  return /(^|\.)content(\[\d+\])+\.toolCallId$/.test(path)
}
