// Working-line dock entry: one dim full-width row above the composer card
// showing the live working-activity line — phase-colored breathing marker,
// the host-composed status line, and the turn's tool count badge.
// Renders for every live phase (waiting/thinking/tool) and the done summary;
// hides while idle or before the first frame.
//
// Data path: the host folds the `workingActivity` session projection and ships
// the whole value to clients; the session standard kit's `useProjection` reads
// it by key. Nothing is appended to the session log, and no client-runtime
// patch is involved — the old `ConversationSnapshot.activity` transport is dead
// on the current host line.
//
// The 'conversation.input.dock' SlotMap declaration lives in
// @deepseek-ai/dsh-client-ui-conversation/client (contract/slots.ts) and the
// `useProjection` standard seat in @deepseek-ai/dsh-client-ui-session/client;
// this entry contributes into the slot without owning it.
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only merges, erased at build time and never required by the bundle:
// the ui-conversation SlotMap entry (the dock seat's owner props) and the
// ui-session standard kit (`useProjection`). ./activity.ts carries this
// package's own projection-key merge, the key constant, and the view type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ACTIVITY_PROJECTION_KEY, type WorkingActivityView } from './activity.ts'
import { refreshElapsedSuffix } from './elapsed.js'
import css from './WorkingLine.module.css'

/** Full props of the dock entry: the input-zone runtime share (session standard kit). */
export type WorkingLineProps = PropsRuntime<'conversation.input.dock'>

/** Tool-count badge copy (no locale seat: the line text itself is host-composed). */
const TOOLS_LABEL = 'tools this turn'

/** The one live tick attachment (exactly one dock row exists at a time). */
let tickAttachment: { readonly el: HTMLElement; readonly timer: ReturnType<typeof setInterval> } | undefined

/**
 * Re-tick the elapsed counter on the mounted text node, once per second.
 *
 * The projection only pushes when a committed event folds (measured: three
 * pushes per turn), so the host-rendered `line` ages between folds — the
 * elapsed text would freeze for the length of a tool. The row therefore
 * re-ticks the ONE moving segment locally; only segments matching the host's
 * elapsed shapes are ever replaced (see ./elapsed.ts).
 *
 * Imperative on purpose, and hook-free: the component is also invoked as a
 * plain function (the bundle gate reads its tree without a renderer), and a
 * ref callback plus this module-level slot is enough — React detaches a
 * changed inline ref with `null` first, which is where the previous interval
 * dies; a settled value simply never attaches a new one.
 */
function attachElapsedTick(el: HTMLElement | null, activity: WorkingActivityView | undefined): void {
  if (tickAttachment !== undefined && (el === null || tickAttachment.el !== el)) {
    clearInterval(tickAttachment.timer)
    tickAttachment = undefined
  }
  if (el === null || activity === undefined || activity.live !== true) return
  const paint = (): void => {
    el.textContent = refreshElapsedSuffix(activity.line, activity, Date.now())
  }
  paint()
  tickAttachment = { el, timer: setInterval(paint, 1000) }
}

/**
 * Working-line dock entry: reads the session's latest `workingActivity`
 * projection value and renders the row, or nothing when idle/absent.
 */
export function WorkingLine({ useProjection }: WorkingLineProps) {
  // `undefined` is the uniform absence signal: the host unit is unmounted, no
  // frame carried the key for this session yet, or no session is current.
  // Rendering nothing (rather than an empty row) keeps the dock from reserving
  // space ahead of the first committed event.
  //
  // The annotation is load-bearing: `useProjection`'s precise engine type lives
  // in the session kit's own dependency (`@deepseek-ai/dsh-api-session-controller`),
  // which this package deliberately does not install (it would drag the whole
  // client peer closure into the dev tree). The key is pinned in ./activity.ts
  // against the merged table; this keeps the render body checked against the
  // host's view type.
  const activity: WorkingActivityView | undefined = useProjection(ACTIVITY_PROJECTION_KEY)
  if (activity === undefined || activity.phase === 'idle' || activity.line === '') return null
  return (
    <div className={css.line} data-activity-phase={activity.phase}>
      <span className={css.marker} aria-hidden="true" />
      <span className={css.text} ref={el => attachElapsedTick(el, activity)}>{activity.line}</span>
      {activity.toolCount > 0 && (
        <span className={css.tools} title={`${activity.toolCount} ${TOOLS_LABEL}`}>
          {activity.toolCount}
        </span>
      )}
    </div>
  )
}
