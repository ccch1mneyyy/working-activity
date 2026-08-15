// Working-line dock entry: one dim full-width row above the composer card
// showing the live working-activity snapshot — phase-colored breathing
// marker, the host-composed status line, and the turn's tool count badge.
// Renders for every live phase (waiting/thinking/tool) and the done summary;
// hides while idle or before the first publish.
//
// The 'conversation.input.dock' SlotMap declaration lives in
// @deepseek-ai/dsh-client-ui-conversation/client (contract/slots.ts); this
// entry contributes into it without owning it.
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './WorkingLine.module.css'

/** Full props of the dock entry: the input-zone runtime share (session standard kit). */
export type WorkingLineProps = PropsRuntime<'conversation.input.dock'>

/** Tool-count badge copy (no locale seat: the line text itself is host-composed). */
const TOOLS_LABEL = 'tools this turn'

/**
 * Working-line dock entry: reads the latest activity snapshot off the
 * conversation snapshot and renders the row, or nothing when idle/absent.
 */
export function WorkingLine({ useSession }: WorkingLineProps) {
  const activity = useSession(s => s.activity)
  if (activity === null || activity.phase === 'idle' || activity.line === '') return null
  return (
    <div className={css.line} data-activity-phase={activity.phase}>
      <span className={css.marker} aria-hidden="true" />
      <span className={css.text}>{activity.line}</span>
      {activity.toolCount > 0 && (
        <span className={css.tools} title={`${activity.toolCount} ${TOOLS_LABEL}`}>
          {activity.toolCount}
        </span>
      )}
    </div>
  )
}
