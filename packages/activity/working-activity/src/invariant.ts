/**
 * Package-owned `activity/status` snapshot invariants.
 * @module dsh-working-activity/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'working-activity-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const PACKAGE_NAME = 'dsh-working-activity'
const PHASES = new Set(['idle', 'waiting', 'thinking', 'tool', 'done'])

/** Validate one published activity snapshot before it reaches the durable log. */
function validateStatus(data: unknown, fail: InvariantFailure): void {
  const record = data as Record<string, unknown> | null
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    fail('activity/status data must be an object')
    return
  }
  if (typeof record.phase !== 'string' || !PHASES.has(record.phase)) {
    fail(`activity/status carries unknown phase ${JSON.stringify(record.phase)}`)
  }
  if (typeof record.line !== 'string' || record.line.length === 0) {
    fail('activity/status line must be a non-empty string')
  }
  for (const key of ['toolCount', 'turnElapsedMs', 'phaseStartedAt']) {
    const value = record[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      fail(`activity/status ${key} must be a non-negative finite number`)
    }
  }
  for (const key of ['label', 'detail', 'phrase']) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      fail(`activity/status ${key} must be a string when present`)
    }
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event shape and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'activity/status') validateStatus(event.data, fail)
}

/**
 * A loaded session as the bootstrap scan must read it. The supported host lines
 * spell the full-log read differently and neither spelling is guaranteed, so
 * both stay optional and the scan probes rather than pinning a version:
 * `snapshotEvents()` is what every first-party companion seeds from
 * (`@deepseek-ai/dsh-session/lib/invariant.js` seeds each `ctx.sessions.list()`
 * entry through it), while the `0.1.0-rc.6` line this package still compiles
 * against exposes only the `events` accessor. On the `0.1.7-rc.2` line that
 * accessor is gone, which is how the previous unconditional `session.events`
 * read threw `TypeError` on the first non-empty session.
 */
interface LoadedSession {
  /** Full immutable log snapshot (`0.1.7-rc.2` line and later). */
  snapshotEvents?: () => readonly SessionEvent[]
  /** Full immutable log accessor (`0.1.0-rc.6` line). */
  readonly events?: readonly SessionEvent[]
}

/**
 * The events of one already-loaded session across those two read shapes. A host
 * exposing neither yields an empty log instead of aborting the companion: the
 * bootstrap scan is best-effort, while the live `internal/dispatch` half must
 * keep validating appended snapshots.
 */
function loadedEvents(session: LoadedSession): readonly SessionEvent[] {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return session.events ?? []
}

/** Install validation for loaded and newly appended activity snapshots. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of loadedEvents(session)) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the working-activity invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
