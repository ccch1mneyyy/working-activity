/**
 * The `workingActivity` session projection — the Web transport for the line.
 *
 * The browser cannot see the host's in-process state, and the previous
 * transport (appending `activity/status` events into the shared session log)
 * made the log unreadable for other readers — the reason dsh-tui mounts this
 * plugin with `publish: false`. A **session projection** is the supported
 * replacement: the host folds committed events into a value and ships it to
 * clients through the projection store, so nothing is written to the log.
 *
 * ## One definition, two host contract shapes
 * The registry's definition contract changed between the corridors this package
 * supports, and every spelling below is still live somewhere:
 *
 * | field | `0.1.0-rc.6` | `0.1.2-alpha.2` | `0.1.7-rc.2` |
 * |---|---|---|---|
 * | state schema | — (every unit ships) | `stateSchema` | `stateSchema` |
 * | wire schema | `schema` | `viewSchema` | `wire.viewSchema` |
 * | view | `view(state)` | `view(state)` | `wire.view(state)` |
 * | `init` arguments | none | `header` | `header`, inherited count |
 *
 * Each `register` implementation reads only the fields it knows and ignores the
 * rest, so the definition below carries **every spelling at once** and registers
 * unchanged on any of them. That is cheaper and far more honest than probing a
 * host version at runtime, and it keeps working for a corridor that mixed the
 * spellings differently again.
 *
 * ## What a client gets, and what it must do itself
 * The projection is event-driven: a value changes when a committed event folds,
 * and never on its own. Elapsed seconds therefore CANNOT stream — the wire
 * carries the timestamps (`phaseStartedAt`, `turnStartedAt`) and the client
 * ticks locally. `line` is included as the host rendered it, which is exact for
 * the settled phases and for any client that does not tick.
 *
 * ## Fold state is self-sufficient on purpose
 * A checkpoint restores and then folds the log's tail without replaying the
 * whole session, so the state must be resumable: it carries an opaque
 * `ActivityTracker.snapshot()` plus the last folded event time. Checkpoints are
 * persisted, which is what {@link ACTIVITY_PROJECTION_STATE_VERSION} gates —
 * bump it whenever the tracker's snapshot shape changes.
 * @module @deepseek-ai/dsh-working-activity/projection
 */

import { z } from 'zod'
import { toActivityEvents } from './compat/session-events.js'
import type { Lang } from './lang.js'
import {
  ActivityTracker,
  TRACKER_SNAPSHOT_VERSION,
  type ActivityPhase,
  type TrackerConfig,
} from './status.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Projection key a client reads: `useProjection('workingActivity')`. */
export const ACTIVITY_PROJECTION_KEY = 'workingActivity'

/**
 * Persisted-cache version of this unit's state. Derived from the tracker
 * snapshot version, so a change to what the fold stores invalidates old
 * checkpoints instead of forward-applying them into garbage.
 */
export const ACTIVITY_PROJECTION_STATE_VERSION = TRACKER_SNAPSHOT_VERSION

/** The client-facing value of the `workingActivity` projection. */
export interface WorkingActivityView {
  /** Which phase the line is in; `idle` means "render nothing". */
  readonly phase: ActivityPhase
  /** The line as the host rendered it at `updatedAt`. */
  readonly line: string
  /** Whether `line` counts elapsed time and a client should tick it locally. */
  readonly live: boolean
  /** Tool action verb (the tool phase's short label), when there is one. */
  readonly label?: string
  /** Tool detail fragment (path / command / pattern), when there is one. */
  readonly detail?: string
  /** The playful phrase or `⏵` narration currently shown, when there is one. */
  readonly phrase?: string
  /** Tools completed in the current turn. */
  readonly toolCount: number
  /** Wall clock the current phase began (what a live `line` counts from). */
  readonly phaseStartedAt: number
  /** Wall clock the current turn began (0 when no turn has started). */
  readonly turnStartedAt: number
  /**
   * Wall clock of the last folded event — the freshness signal a client needs
   * to distrust a persisted `cached` row from a process that is gone. It is
   * session time (event timestamps), not the moment the fold ran, so it stays
   * meaningful across a restart.
   */
  readonly updatedAt: number
  /** Language `line` was rendered in, so a ticking client matches its copy. */
  readonly lang: Lang
}

/** Per-session fold state. Opaque outside this module (see the module doc). */
interface ActivityProjectionState {
  /** `ActivityTracker.snapshot()` of the session folded so far. */
  readonly tracker: unknown
  /** Timestamp of the last event that changed the fold. */
  readonly updatedAt: number
}

/** Anything the tracker's snapshot refuses to parse is a stale checkpoint. */
const stateSchema = z.object({
  tracker: z.unknown(),
  updatedAt: z.number(),
})

const viewSchema = z.object({
  phase: z.enum(['idle', 'waiting', 'thinking', 'tool', 'done']),
  line: z.string(),
  live: z.boolean(),
  label: z.string().optional(),
  detail: z.string().optional(),
  phrase: z.string().optional(),
  toolCount: z.number(),
  phaseStartedAt: z.number(),
  turnStartedAt: z.number(),
  updatedAt: z.number(),
  lang: z.enum(['zh', 'en']),
})

/** What a live host can overlay onto the folded value (any subset). */
export interface LiveActivityOverlay {
  /** The `⏵` narration most recently streamed for this session. */
  readonly narration?: string
  /** When that narration arrived (its freshness clock). */
  readonly lastChunkAt?: number
  /**
   * When the first streamed token arrived, when the host knows it.
   *
   * Deltas are live frames on the current host line and never fold, so
   * without this the projected line sits in the waiting pool for the entire
   * generation — telling the user "still queuing" while the model writes.
   * Applying it promotes a waiting fold to thinking (the same rule a live
   * delta follows: never while a tool holds the phase).
   */
  readonly firstTokenAt?: number
}

/** Knobs a projection needs; all of them are also plugin configuration. */
export interface ActivityProjectionOptions {
  /** Behavioral knobs of the tracker to fold with. */
  readonly trackerConfig: TrackerConfig
  /** Custom action pools for tool copy. */
  readonly customActions?: Readonly<Record<string, readonly string[]>>
  /** Wall clock used to render the wire value (injectable for tests). */
  readonly now?: () => number
  /** Live UI language tag, so clients render in the same language. */
  readonly lang: () => Lang
  /**
   * Live narration for one folded state, when the host has any.
   *
   * The narration is streamed, and a projection only folds committed events, so
   * without this the projected line would never show the model's own words. The
   * host keeps the frames and hands the freshest line over per read; the value
   * still derives everything else from the log. Corridors whose registry has no
   * `stateOf` (rc.6) simply never call this and fall back to the narration that
   * settled messages carry.
   */
  readonly live?: (state: unknown) => LiveActivityOverlay | undefined
}

/**
 * Build the `workingActivity` projection definition.
 * @param options - tracker configuration, clock and language supplier.
 * @returns a definition object registerable on every supported host corridor.
 */
export function createActivityProjection(options: ActivityProjectionOptions): {
  key: string
  stateVersion: number
  stateSchema: typeof stateSchema
  wire: { viewSchema: typeof viewSchema; view: (state: unknown) => WorkingActivityView }
  schema: typeof viewSchema
  viewSchema: typeof viewSchema
  view: (state: unknown) => WorkingActivityView
  init: () => ActivityProjectionState
  apply: (state: unknown, event: SessionEvent) => ActivityProjectionState
} {
  const now = options.now ?? Date.now
  const fresh = (): ActivityTracker =>
    new ActivityTracker(options.trackerConfig, now, options.customActions)
  // A checkpoint the tracker refuses is stale, not fatal: `view` runs inside
  // the host's synchronous dispatch, and a same-version-but-unusable payload
  // (torn write, hand-edited cache) must degrade to "fold from here" rather
  // than throw through every listener. The host's own version gate still
  // discards checkpoints from older builds before they get here.
  const restoreOrFresh = (state: ActivityProjectionState): ActivityTracker => {
    try {
      return ActivityTracker.restore(
        options.trackerConfig,
        now,
        options.customActions,
        state.tracker,
      )
    } catch {
      return fresh()
    }
  }

  /**
   * Render the current value. Called by the host when a fold changes and on
   * every read, so the line it returns is as fresh as the read.
   */
  const view = (raw: unknown): WorkingActivityView => {
    const state = raw as ActivityProjectionState
    // One clock read for the whole value: rendering and deriving the turn's
    // start instant from the rendered elapsed must agree exactly.
    const at = now()
    const tracker = restoreOrFresh(state)
    // A projection folds durable events, but two things the line displays are
    // born on live stream frames: the `⏵` self-narration, and that the first
    // token already arrived. The host that owns the frames overlays both here,
    // so the value keeps the live truth without writing anything to the log.
    const live = options.live?.(state)
    if (live !== undefined) tracker.applyLiveState(live)
    const rendered = tracker.render(at)
    const running = rendered.phase !== 'idle' && rendered.phase !== 'done'
    return {
      phase: rendered.phase,
      line: rendered.line,
      live: running,
      ...(rendered.label === undefined ? {} : { label: rendered.label }),
      ...(rendered.detail === undefined ? {} : { detail: rendered.detail }),
      ...(rendered.phrase === undefined ? {} : { phrase: rendered.phrase }),
      toolCount: rendered.toolCount,
      phaseStartedAt: rendered.phaseStartedAt,
      // `ActivityState` reports elapsed rather than the turn's start instant.
      // The difference is exact, and a client needs the instant to keep
      // ticking; only the idle phase means "there is no turn" — an elapsed of
      // zero is a turn that just started, not an absent one.
      turnStartedAt: rendered.phase === 'idle' ? 0 : at - rendered.turnElapsedMs,
      updatedAt: state.updatedAt,
      lang: options.lang(),
    }
  }

  return {
    key: ACTIVITY_PROJECTION_KEY,
    stateVersion: ACTIVITY_PROJECTION_STATE_VERSION,
    stateSchema,
    wire: { viewSchema, view },
    // The rc.6-era and alpha.2-era spellings of the same two fields (see the
    // module doc): every register implementation reads only what it knows.
    schema: viewSchema,
    viewSchema,
    view,
    init: (): ActivityProjectionState => ({ tracker: fresh().snapshot(), updatedAt: 0 }),
    apply: (raw: unknown, event: SessionEvent): ActivityProjectionState => {
      const state = raw as ActivityProjectionState
      const events = toActivityEvents(event)
      // An event this unit does not model MUST return the same reference: the
      // host treats it as "zero downstream work".
      if (events.length === 0) return state
      const tracker = restoreOrFresh(state)
      for (const activityEvent of events) tracker.onEvent(activityEvent)
      const next = tracker.snapshot()
      const updatedAt = typeof event.time === 'number' ? event.time : state.updatedAt
      // `next` is a fresh object by construction (`snapshot()` rebuilds), so
      // content-comparing it against the previous state could only ever
      // suppress the exotic same-millisecond no-op duplicate — while paying a
      // double JSON serialization of the whole fold on EVERY modelled event.
      // An occasional extra publish of an identical line is cheaper than that.
      return { tracker: next, updatedAt }
    },
  }
}
