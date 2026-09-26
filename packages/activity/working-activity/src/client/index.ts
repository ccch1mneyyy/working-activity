/**
 * Working-activity surface plugin, browser half: the working-line entry in
 * the conversation.input.dock strip.
 *
 * The node half folds every committed session event into the `workingActivity`
 * session projection and the host ships that value to clients; this dock entry
 * reads it through the session standard kit's `useProjection` and owns no
 * store, no refresh chain, and no event listener. Nothing is appended to the
 * session log — the reason dsh-tui mounts this plugin with `publish: false`.
 *
 * Mount contract (see the root README's "Web UI 集成" section): the web
 * client's client-modules host scans loader entries for `dsh.client`
 * declarations and serves this package's `./client` bundle at
 * /plugins/dsh-working-activity/client.js. The entry contributes into the
 * input dock — no official-source patch is involved.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only merges: the ui-conversation SlotMap entry (the dock seat) and the
// ui-renderer `slots` service on the client Context. Both are erased at build
// time and never required by the bundle.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { WorkingLine } from './WorkingLine.tsx'

export { WorkingLine, type WorkingLineProps } from './WorkingLine.tsx'
export type { WorkingActivityView } from './activity.ts'

/** Required services for the dock registration. */
export const inject = ['slots']

/**
 * Client plugin body: the working-line dock entry.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    // The pre-slots patch used the same id in ui-conversation; entries with
    // equal order render in registration order, and goal (10) / queue (20)
    // keep their seats — this row sits between them.
    id: 'activity',
    order: 15,
    registrant: 'dsh-working-activity',
  }, WorkingLine))
}
