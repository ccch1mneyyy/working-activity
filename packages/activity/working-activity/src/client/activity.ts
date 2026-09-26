/**
 * Client-side contract of the working-activity Web half: the `workingActivity`
 * key of the session-projection type table.
 *
 * The browser reads the line through the session standard kit's
 * `useProjection('workingActivity')` — the host folds the projection from
 * committed session events and ships the whole value, so no client-side domain
 * folding exists and nothing is appended to the session log.
 *
 * The runtime patch that used to carry the value on the conversation snapshot
 * (`ConversationSnapshot.activity`, declared against `@deepseek-ai/dsh-client-runtime`)
 * is obsolete for the current host line: that package is frozen at `0.1.1-rc.2`
 * and absent from the `0.1.7-rc.2` client cohort.
 *
 * {@link WorkingActivityView} is imported from the host half on purpose — one
 * definition of the wire value, so the two halves cannot drift. The import is
 * TYPE-ONLY: a value import would pull host-only code (zod, node builtins) into
 * the browser bundle, which the build's purity gate rejects.
 * @module @deepseek-ai/dsh-working-activity/client/activity
 */

import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
import type { WorkingActivityView } from '../projection.js'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Latest folded working line for the current session, or absent while the
     * host unit is unmounted or no committed event has folded yet.
     */
    workingActivity: WorkingActivityView
  }
}

/**
 * The projection key this package reads, checked against the merged table: a
 * rename on the host side, or a merge that silently failed to land, is a
 * compile error here instead of a dock row that never renders.
 */
export const ACTIVITY_PROJECTION_KEY =
  'workingActivity' satisfies Extract<keyof SessionProjectionMap, string>

export type { WorkingActivityView }
