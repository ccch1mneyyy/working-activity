/**
 * Invariant-companion tests: the `activity/status` payload contract and the
 * already-loaded-session scan. That scan is the regression this file exists
 * for — the companion read `session.events`, an accessor the DSH `0.1.7-rc.2`
 * line no longer has, so installing it threw `TypeError` on the first
 * non-empty session. Both measured read shapes are physical fixtures (each
 * asserts the key the other carries is absent, so a fixture cannot silently
 * become both), and a stub context plus a recording collector stand in for the
 * `@deepseek-ai/dsh-invariants` registry: these assertions are about the
 * companion, not about booting a host composition.
 *
 * The recording collector never throws, unlike the registry's reporter
 * (`InvariantFailure` returns `never`), so one payload can be shown to violate
 * several rules; the registry itself stops at the first thrown message.
 * @module @deepseek-ai/dsh-working-activity/tests/invariant
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ActivityStatusEvent } from '../src/events.ts'
import { apply, inject, name } from '../src/invariant.ts'

/** One complete, valid snapshot: the shape the tracker publishes. */
const VALID: ActivityStatusEvent = {
  phase: 'tool',
  line: '跑个命令 npm test · 12s',
  label: '跑个命令',
  detail: 'npm test',
  phrase: '盘一下盘一下',
  toolCount: 2,
  turnElapsedMs: 12_000,
  phaseStartedAt: 1_700_000_000_000,
}

/** The published phase vocabulary, as the plugin declares it. */
const PHASES = ['idle', 'waiting', 'thinking', 'tool', 'done'] as const

/** Metrics every snapshot must carry as non-negative finite numbers. */
const METRICS = ['toolCount', 'turnElapsedMs', 'phaseStartedAt'] as const

/** Optional string fields, absent or a string and nothing else. */
const OPTIONAL_STRINGS = ['label', 'detail', 'phrase'] as const

/** Event types the companion must ignore even when their data looks like a snapshot. */
const UNRELATED_TYPES = ['turn/start', 'tool/result', 'assistant/chunk', 'session/title', 'todo/write']

/** A payload that violates three rules at once, for the ignored-event tests. */
const JUNK_SNAPSHOT = { phase: 'bogus', line: '', toolCount: -1 }

/**
 * A session as the DSH `0.1.7-rc.2` line presents it: the log is reachable only
 * through `snapshotEvents()`. The absent `events` key is the point — this is
 * the shape the previous unconditional read crashed on.
 */
function snapshotSession(events: readonly SessionEvent[]): Session {
  return { snapshotEvents: () => events } as unknown as Session
}

/**
 * A session as the DSH `0.1.0-rc.6` line presents it (the line this package
 * still compiles against): the log is the `events` accessor only.
 */
function accessorSession(events: readonly SessionEvent[]): Session {
  return { events } as unknown as Session
}

/** One event of a chosen type carrying a chosen — possibly malformed — payload. */
function eventOf(type: string, data: unknown): SessionEvent {
  return { type, seq: 7, time: 1_700_000_000_000, data } as unknown as SessionEvent
}

/** One `activity/status` event as the plugin publishes it (log-only, no surface op). */
function statusEvent(data: unknown): SessionEvent {
  return eventOf('activity/status', data)
}

/** Whether one key is an own property, so a fixture's shape is a physical fact. */
function hasOwn(value: object, key: string): boolean {
  return Object.hasOwn(value, key)
}

/** Stable case label for a synthetic value (never real payload content). */
function label(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value) ?? String(value)
}

/** The `internal/dispatch` listener the companion installed. */
type DispatchListener = (mode: string, eventName: string, args: unknown[]) => void

/** One mounted companion: what it registered, and how to drive it. */
interface Mounted {
  /** Messages reported, in the order they were reported. */
  readonly failures: string[]
  /** The package name the companion reserved in the registry. */
  readonly packageName: string | undefined
  /** The services the installer declared for its child fiber. */
  readonly installerInject: unknown
  /** The options every listener registration carried. */
  readonly listenerOptions: readonly unknown[]
  /** The disposer `apply` resolved to. */
  readonly dispose: () => void
  /** Feed one appended event through the live `internal/dispatch` half. */
  append(event: SessionEvent): void
  /** Feed one other internal dispatch (any event name) through that half. */
  dispatchInternal(eventName: string, args: unknown[]): void
}

/**
 * Mount the companion on a stub context holding `sessions`, mirroring the
 * registry only as far as driving it needs: reserve the package name, run the
 * installer in a child context carrying the injected `sessions` service, and
 * collect every reported message.
 */
async function mount(sessions: readonly Session[] = []): Promise<Mounted> {
  const failures: string[] = []
  const fail = ((message: string) => { failures.push(message) }) as unknown as InvariantFailure
  const listeners = new Map<string, DispatchListener>()
  const listenerOptions: unknown[] = []
  let packageName: string | undefined
  let installer: InvariantInstaller | undefined
  const sessionsService = { list: () => sessions }
  const child = {
    sessions: sessionsService,
    on: (event: string, listener: DispatchListener, options?: unknown) => {
      listeners.set(event, listener)
      listenerOptions.push(options)
      return () => {}
    },
  } as unknown as Context
  const ctx = {
    sessions: sessionsService,
    invariants: {
      register: (owner: string, registered: InvariantInstaller) => {
        packageName = owner
        installer = registered
        void registered(child, fail)
        return () => {}
      },
    },
  } as unknown as Context
  const dispatch = (eventName: string, args: unknown[]): void => {
    listeners.get('internal/dispatch')?.('parallel', eventName, args)
  }
  // `apply` runs the installer inside `register`, so the registration facts are
  // only readable after it settles.
  const dispose = await apply(ctx)
  return {
    failures,
    packageName,
    listenerOptions,
    installerInject: installer?.inject,
    dispose,
    append: event => { dispatch('session/event', [snapshotSession([]), event]) },
    dispatchInternal: dispatch,
  }
}

describe('activity/status payload contract', () => {
  it('accepts a complete published snapshot', async () => {
    const mounted = await mount()
    mounted.append(statusEvent(VALID))
    expect(mounted.failures).toEqual([])
  })

  it('accepts every published phase and a zero metric', async () => {
    const mounted = await mount()
    for (const phase of PHASES) mounted.append(statusEvent({ ...VALID, phase }))
    mounted.append(statusEvent({ ...VALID, toolCount: 0, turnElapsedMs: 0, phaseStartedAt: 0 }))
    expect(mounted.failures).toEqual([])
  })

  it('accepts absent or explicitly undefined optional strings', async () => {
    const mounted = await mount()
    const absent: Record<string, unknown> = { ...VALID }
    for (const key of OPTIONAL_STRINGS) delete absent[key]
    mounted.append(statusEvent(absent))
    mounted.append(statusEvent({ ...VALID, label: undefined }))
    expect(mounted.failures).toEqual([])
  })

  it('rejects an unknown phase with the exact vocabulary message', async () => {
    const cases: readonly { readonly phase: unknown; readonly message: string }[] = [
      { phase: 'paused', message: 'activity/status carries unknown phase "paused"' },
      { phase: 'TOOL', message: 'activity/status carries unknown phase "TOOL"' },
      { phase: '', message: 'activity/status carries unknown phase ""' },
      { phase: 42, message: 'activity/status carries unknown phase 42' },
      { phase: null, message: 'activity/status carries unknown phase null' },
      { phase: undefined, message: 'activity/status carries unknown phase undefined' },
      { phase: ['tool'], message: 'activity/status carries unknown phase ["tool"]' },
    ]
    for (const { phase, message } of cases) {
      const mounted = await mount()
      mounted.append(statusEvent({ ...VALID, phase }))
      expect(mounted.failures, label(phase)).toEqual([message])
    }
  })

  it('rejects a payload that is not an object', async () => {
    const cases: readonly { readonly case: string; readonly payload: unknown }[] = [
      { case: 'null', payload: null },
      { case: 'undefined', payload: undefined },
      { case: 'a number', payload: 42 },
      { case: 'a string', payload: 'activity/status' },
      { case: 'a boolean', payload: true },
      { case: 'an array', payload: [VALID] },
    ]
    for (const { case: name, payload } of cases) {
      const mounted = await mount()
      mounted.append(statusEvent(payload))
      expect(mounted.failures, name).toEqual(['activity/status data must be an object'])
    }
  })

  it('rejects a missing, empty, or non-string line', async () => {
    for (const line of [undefined, '', 42, null, ['line'], {}]) {
      const mounted = await mount()
      mounted.append(statusEvent({ ...VALID, line }))
      expect(mounted.failures, label(line)).toEqual(['activity/status line must be a non-empty string'])
    }
  })

  it('rejects a negative or non-finite metric on every metric field', async () => {
    const values = [-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '5', null, undefined, true]
    for (const key of METRICS) {
      for (const value of values) {
        const mounted = await mount()
        mounted.append(statusEvent({ ...VALID, [key]: value }))
        expect(mounted.failures, `${key}=${label(value)}`)
          .toEqual([`activity/status ${key} must be a non-negative finite number`])
      }
    }
  })

  it('rejects an optional field that is present but not a string', async () => {
    for (const key of OPTIONAL_STRINGS) {
      for (const value of [42, null, {}, []]) {
        const mounted = await mount()
        mounted.append(statusEvent({ ...VALID, [key]: value }))
        expect(mounted.failures, `${key}=${label(value)}`)
          .toEqual([`activity/status ${key} must be a string when present`])
      }
    }
  })

  it('reports every violated rule of one payload', async () => {
    const mounted = await mount()
    mounted.append(statusEvent({ ...VALID, phase: 'paused', line: '', toolCount: -1 }))
    expect(mounted.failures).toEqual([
      'activity/status carries unknown phase "paused"',
      'activity/status line must be a non-empty string',
      'activity/status toolCount must be a non-negative finite number',
    ])
  })
})

describe('unrelated events', () => {
  it('ignores every unrelated event type, whatever its data looks like', async () => {
    const mounted = await mount()
    for (const type of UNRELATED_TYPES) mounted.append(eventOf(type, JUNK_SNAPSHOT))
    expect(mounted.failures).toEqual([])
  })

  it('ignores an internal dispatch that is not session/event', async () => {
    const mounted = await mount()
    mounted.dispatchInternal('agent/status', [JUNK_SNAPSHOT])
    mounted.dispatchInternal('session/created', [snapshotSession([])])
    expect(mounted.failures).toEqual([])
  })

  it('validates a snapshot appended after mount and reads it from the event argument', async () => {
    const mounted = await mount()
    mounted.append(statusEvent(VALID))
    mounted.append(statusEvent({ ...VALID, phase: 'paused' }))
    // Reading `args[0]` (the session) instead of `args[1]` would validate
    // nothing here and leave both messages missing.
    expect(mounted.failures).toEqual(['activity/status carries unknown phase "paused"'])
  })
})

describe('already-loaded sessions', () => {
  it('keeps the two host-line fixtures physically disjoint', () => {
    expect(hasOwn(snapshotSession([]), 'snapshotEvents')).toBe(true)
    expect(hasOwn(snapshotSession([]), 'events')).toBe(false)
    expect(hasOwn(accessorSession([]), 'events')).toBe(true)
    expect(hasOwn(accessorSession([]), 'snapshotEvents')).toBe(false)
  })

  it('installs on a 0.1.7-rc.2 session that has no activity events at all', async () => {
    // The regression: this shape has no `events` accessor, so the previous
    // read threw `TypeError: session.events is not iterable` here.
    const mounted = await mount([snapshotSession([])])
    expect(mounted.failures).toEqual([])
  })

  it('installs on a 0.1.0-rc.6 session that has no activity events at all', async () => {
    const mounted = await mount([accessorSession([])])
    expect(mounted.failures).toEqual([])
  })

  it('validates loaded snapshots through the 0.1.7-rc.2 read', async () => {
    const mounted = await mount([
      snapshotSession([eventOf('turn/start', {}), statusEvent({ ...VALID, phase: 'paused' })]),
    ])
    expect(mounted.failures).toEqual(['activity/status carries unknown phase "paused"'])
  })

  it('validates loaded snapshots through the 0.1.0-rc.6 read', async () => {
    const mounted = await mount([
      accessorSession([eventOf('tool/result', {}), statusEvent({ ...VALID, line: '' })]),
    ])
    expect(mounted.failures).toEqual(['activity/status line must be a non-empty string'])
  })

  it('scans every loaded session and ignores their unrelated events', async () => {
    const mounted = await mount([
      snapshotSession([eventOf('turn/start', JUNK_SNAPSHOT), statusEvent({ ...VALID, toolCount: -1 })]),
      accessorSession([statusEvent(VALID), eventOf('assistant/chunk', JUNK_SNAPSHOT)]),
      snapshotSession([]),
    ])
    expect(mounted.failures).toEqual(['activity/status toolCount must be a non-negative finite number'])
  })

  it('installs on a session exposing neither read instead of throwing', async () => {
    // A host API that moved on again is not a payload violation: the bootstrap
    // scan is skipped, while the append half keeps validating (covered above).
    const mounted = await mount([{} as Session])
    expect(mounted.failures).toEqual([])
  })
})

describe('registration surface', () => {
  it('keeps the published name, injection, and installer contract', async () => {
    const mounted = await mount()
    expect(name).toBe('working-activity-invariant')
    expect(inject).toEqual(['invariants'])
    expect(mounted.packageName).toBe('dsh-working-activity')
    expect(mounted.installerInject).toEqual(['sessions'])
    expect(mounted.listenerOptions).toEqual([{ global: true }])
    expect(mounted.dispose).toBeTypeOf('function')
  })
})
