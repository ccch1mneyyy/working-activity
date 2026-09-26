/**
 * Compat tests for the `tool/result` payload readers: call-id precedence across
 * the modern `message.source.callId` shape, the `message.toolCallId` echo, and
 * the legacy content-block `toolCallId` — plus the three independent failure
 * signals. Fixtures are physical (a separate literal per host shape) and every
 * shape asserts the keys it must NOT carry, so dropping a tier breaks these
 * tests instead of silently resolving no id at all.
 * @module @deepseek-ai/dsh-working-activity/tests/tool-result
 */

import { describe, expect, it } from 'vitest'
import { resultCallId, resultFailed } from '../src/compat/tool-result.ts'

/**
 * One physical `tool/result` fixture. The id-bearing fields are `unknown` so a
 * test can inject a wrong value (number, array, empty string) without a cast;
 * optionality is what makes "the legacy fixture carries no modern field" a
 * physical statement rather than an `undefined`-valued one.
 */
interface ResultFixture {
  data: {
    turn: number
    step: number
    message: {
      role: string
      /** Modern tier: `{ kind: 'tool', callId }`. */
      source?: unknown
      /** The id echo the measured host line also writes. */
      toolCallId?: unknown
      content: unknown
      isError?: unknown
      id: string
    }
    error?: unknown
  }
}

/**
 * Modern fixture (DSH 0.1.7-rc.2 line): the id lives in `message.source.callId`
 * and is echoed by `message.toolCallId`; the content block is a plain text
 * block with no id of its own.
 */
function modernResult(callId = 'call-modern'): ResultFixture {
  return {
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        source: { kind: 'tool', callId },
        toolCallId: callId,
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
        id: 'msg-1',
      },
    },
  }
}

/** Legacy fixture: the id exists ONLY on the content block. */
function legacyResult(callId = 'call-legacy'): ResultFixture {
  return {
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        }],
      },
    },
  }
}

/**
 * Whether a key path exists as an OWN property of the fixture. `Object.hasOwn`
 * sees a key that was set to `undefined`, where an `in` / `!== undefined` read
 * would not — which is exactly the distinction the shape assertions need.
 */
function hasOwnPath(root: unknown, path: readonly string[]): boolean {
  let cursor: unknown = root
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return false
    if (!Object.hasOwn(cursor, key)) return false
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return true
}

/** Stable table-row label for a synthetic value (never real payload content). */
function label(value: unknown): string {
  return String(JSON.stringify(value))
}

/** Id values that must never be returned: empty, wrong type, or a collection. */
const UNUSABLE_IDS: readonly unknown[] = ['', '   ', 42, 0, true, null, undefined, { id: 'call-x' }, ['call-x']]

describe('resultCallId on the two measured host shapes', () => {
  it('resolves the modern payload with no legacy content-block id', () => {
    const event = modernResult()
    expect(resultCallId(event)).toBe('call-modern')
    // Physical shape: the legacy-tier path cannot be what resolved this.
    expect(hasOwnPath(event, ['data', 'message', 'source', 'callId'])).toBe(true)
    expect(hasOwnPath(event, ['data', 'message', 'toolCallId'])).toBe(true)
    expect(hasOwnPath(event, ['data', 'message', 'content', '0', 'toolCallId'])).toBe(false)
  })

  it('resolves the legacy payload with no modern field', () => {
    const event = legacyResult()
    expect(resultCallId(event)).toBe('call-legacy')
    expect(hasOwnPath(event, ['data', 'message', 'content', '0', 'toolCallId'])).toBe(true)
    expect(hasOwnPath(event, ['data', 'message', 'source'])).toBe(false)
    expect(hasOwnPath(event, ['data', 'message', 'toolCallId'])).toBe(false)
  })

  it('keeps the modern and the legacy fixture disjoint in the expected keys', () => {
    const modern = modernResult()
    const legacy = legacyResult()
    for (const path of [['data', 'message', 'source'], ['data', 'message', 'toolCallId']]) {
      expect(hasOwnPath(modern, path), `modern ${path.join('.')}`).toBe(true)
      expect(hasOwnPath(legacy, path), `legacy ${path.join('.')}`).toBe(false)
    }
    const blockId = ['data', 'message', 'content', '0', 'toolCallId']
    expect(hasOwnPath(modern, blockId), 'modern block id').toBe(false)
    expect(hasOwnPath(legacy, blockId), 'legacy block id').toBe(true)
  })

  it('returns undefined when no tier carries an id', () => {
    const event = modernResult()
    delete event.data.message.source
    delete event.data.message.toolCallId
    expect(hasOwnPath(event, ['data', 'message', 'source'])).toBe(false)
    expect(hasOwnPath(event, ['data', 'message', 'toolCallId'])).toBe(false)
    expect(resultCallId(event)).toBeUndefined()
  })
})

describe('resultCallId precedence', () => {
  it('prefers source.callId when every tier carries a different id', () => {
    const event = modernResult('from-source')
    event.data.message.toolCallId = 'from-message'
    event.data.message.content = [{ type: 'tool-result', toolCallId: 'from-content' }]
    expect(resultCallId(event)).toBe('from-source')
  })

  it('prefers message.toolCallId over the content block when source is absent', () => {
    const event = modernResult('from-message')
    delete event.data.message.source
    event.data.message.content = [{ type: 'tool-result', toolCallId: 'from-content' }]
    expect(resultCallId(event)).toBe('from-message')
  })

  it('never takes the id from a source whose kind is not tool', () => {
    const event = modernResult('call-modern')
    event.data.message.source = { kind: 'user', callId: 'from-source' }
    // Falls through to the next tier rather than trusting `source.callId`.
    expect(resultCallId(event)).toBe('call-modern')
  })

  it('never takes the id from a source with an absent or near-miss tool kind', () => {
    for (const kind of [undefined, null, 'model', 'Tool', 'tool ']) {
      const event = modernResult('call-modern')
      event.data.message.source = { kind, callId: 'from-source' }
      expect(resultCallId(event), String(kind)).toBe('call-modern')
    }
  })

  it('ignores a source that is not a record', () => {
    for (const source of ['tool', 42, null, ['tool'], true]) {
      const event = modernResult('call-modern')
      event.data.message.source = source
      expect(resultCallId(event), String(source)).toBe('call-modern')
    }
  })

  it('returns undefined when a non-tool source is the only candidate', () => {
    const event = modernResult()
    delete event.data.message.toolCallId
    event.data.message.source = { kind: 'user', callId: 'from-source' }
    expect(resultCallId(event)).toBeUndefined()
  })
})

describe('resultCallId unusable id values', () => {
  it('rejects an unusable source.callId and falls through', () => {
    for (const value of UNUSABLE_IDS) {
      const event = modernResult('call-modern')
      event.data.message.source = { kind: 'tool', callId: value }
      expect(resultCallId(event), label(value)).toBe('call-modern')
    }
  })

  it('rejects an unusable message.toolCallId and falls through to the block', () => {
    for (const value of UNUSABLE_IDS) {
      const event = legacyResult()
      event.data.message.toolCallId = value
      expect(resultCallId(event), label(value)).toBe('call-legacy')
    }
  })

  it('rejects an unusable content-block id and takes the next usable block', () => {
    for (const value of UNUSABLE_IDS) {
      const event = legacyResult()
      event.data.message.content = [
        { type: 'tool-result', toolCallId: value },
        { type: 'tool-result', toolCallId: 'call-next' },
      ]
      expect(resultCallId(event), label(value)).toBe('call-next')
    }
  })

  it('returns undefined when every tier is unusable', () => {
    const event = modernResult()
    event.data.message.source = { kind: 'tool', callId: '' }
    event.data.message.toolCallId = 7
    event.data.message.content = [{ type: 'text', toolCallId: ['call-x'] }]
    expect(resultCallId(event)).toBeUndefined()
  })

  it('rejects a whitespace-only id (an id needs one non-whitespace character)', () => {
    const event = modernResult()
    event.data.message.source = { kind: 'tool', callId: ' \t ' }
    event.data.message.toolCallId = '\n'
    event.data.message.content = [{ type: 'tool-result', toolCallId: ' ' }]
    expect(resultCallId(event)).toBeUndefined()
  })

  it('returns a usable id verbatim, never trimmed', () => {
    // Trimming would break exact pairing against the tool/call id.
    expect(resultCallId(modernResult(' call-padded '))).toBe(' call-padded ')
  })
})

describe('resultCallId on malformed payloads', () => {
  it('returns undefined for null', () => {
    expect(resultCallId(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(resultCallId(undefined)).toBeUndefined()
  })

  it('returns undefined for an empty event', () => {
    expect(resultCallId({})).toBeUndefined()
  })

  it('returns undefined when data is null', () => {
    expect(resultCallId({ data: null })).toBeUndefined()
    expect(resultFailed({ data: null })).toBe(false)
  })

  it('returns undefined when content is not an array', () => {
    expect(resultCallId({ data: { message: { content: 'nope' } } })).toBeUndefined()
    expect(resultFailed({ data: { message: { content: 'nope' } } })).toBe(false)
  })

  it('survives a zoo of wrong-typed payloads without throwing', () => {
    const zoo: readonly { readonly case: string; readonly payload: unknown }[] = [
      { case: 'a number', payload: 42 },
      { case: 'a string', payload: 'tool/result' },
      { case: 'an empty array', payload: [] },
      { case: 'data as an array', payload: { data: [] } },
      { case: 'message as null', payload: { data: { message: null } } },
      { case: 'message as an array', payload: { data: { message: [] } } },
      { case: 'message as a string', payload: { data: { message: 'no' } } },
      { case: 'content as an object', payload: { data: { message: { content: {} } } } },
      { case: 'scalar content blocks', payload: { data: { message: { content: [null, 42, 'x'] } } } },
      { case: 'a record toolCallId', payload: { data: { message: { toolCallId: { id: 'call-x' } } } } },
      { case: 'a deep missing branch', payload: { data: { message: { content: [{ block: { toolCallId: 'call-x' } }] } } } },
    ]
    for (const { case: name, payload } of zoo) {
      expect(() => resultCallId(payload), name).not.toThrow()
      expect(resultCallId(payload), name).toBeUndefined()
      expect(resultFailed(payload), name).toBe(false)
    }
  })
})

describe('resultFailed', () => {
  it('reports a data.error-only failure (no isError anywhere)', () => {
    const event = modernResult()
    event.data.error = { name: 'ToolError', code: 'E_TOOL' }
    expect(event.data.message.isError).toBe(false)
    expect(hasOwnPath(event, ['data', 'message', 'isError'])).toBe(true)
    expect(resultFailed(event)).toBe(true)
  })

  it('reports a message.isError-only failure (no data.error)', () => {
    const event = modernResult()
    event.data.message.isError = true
    expect(hasOwnPath(event, ['data', 'error'])).toBe(false)
    expect(resultFailed(event)).toBe(true)
  })

  it('reports a content-block isError failure (the legacy signal)', () => {
    const event = legacyResult()
    event.data.message.content = [{
      type: 'tool-result', toolCallId: 'call-legacy', content: [], isError: true,
    }]
    expect(hasOwnPath(event, ['data', 'error'])).toBe(false)
    expect(resultFailed(event)).toBe(true)
  })

  it('reports failure when several signals are present at once', () => {
    const event = legacyResult()
    event.data.error = { name: 'ToolError', code: 'E_TOOL' }
    event.data.message.isError = true
    event.data.message.content = [{ type: 'tool-result', toolCallId: 'call-legacy', isError: true }]
    expect(resultFailed(event)).toBe(true)
  })

  it('reports an explicit isError: false as healthy', () => {
    const event = modernResult()
    event.data.message.isError = false
    event.data.message.content = [{ type: 'tool-result', toolCallId: 'call-modern', isError: false }]
    expect(resultFailed(event)).toBe(false)
  })

  it('reports the clean fixtures as healthy', () => {
    expect(resultFailed(modernResult())).toBe(false)
    expect(resultFailed(legacyResult())).toBe(false)
  })

  it('counts a present error field, not a truthy one', () => {
    const withNull = modernResult()
    withNull.data.error = null
    expect(resultFailed(withNull)).toBe(true)

    const withUndefined = modernResult()
    withUndefined.data.error = undefined
    expect(hasOwnPath(withUndefined, ['data', 'error'])).toBe(true)
    expect(resultFailed(withUndefined)).toBe(false)
  })

  it('rejects non-boolean isError values', () => {
    for (const value of ['true', 1, 'yes', {}, []]) {
      const event = modernResult()
      event.data.message.isError = value
      event.data.message.content = [{ type: 'tool-result', toolCallId: 'call-modern', isError: value }]
      expect(resultFailed(event), label(value)).toBe(false)
    }
  })

  it('ignores a data-level isError flag', () => {
    const payload = { data: { isError: true, message: { content: [{ type: 'text', text: 'ok' }] } } }
    expect(resultFailed(payload)).toBe(false)
  })

  it('ignores an error field on the message (only data.error counts)', () => {
    const payload = { data: { message: { error: { name: 'X', code: 'Y' }, content: [] } } }
    expect(resultFailed(payload)).toBe(false)
  })

  it('reports failure from data.error even when the message is malformed', () => {
    const payload = { data: { error: { name: 'X', code: 'Y' }, message: null } }
    expect(resultFailed(payload)).toBe(true)
  })
})
