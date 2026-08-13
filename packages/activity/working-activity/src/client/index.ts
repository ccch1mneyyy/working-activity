/**
 * Working-activity surface plugin, browser half: the working-line entry in
 * the conversation.input.dock strip. This package's node half emits
 * `activity/status` session events; the web runtime patch narrows them into
 * the conversation snapshot's `activity` member, so this dock entry reads
 * the live frame through the standard session kit and owns no store, no
 * refresh chain, and no event listener.
 *
 * Mount contract (see the root README's "Web UI 集成" section): the web
 * client's client-modules host scans loader entries for `dsh.client`
 * declarations and serves this package's `./client` bundle at
 * /plugins/dsh-working-activity/client.js. The entry contributes into the
 * input dock — no official-source patch is involved.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry)
// through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { WorkingLine } from './WorkingLine.tsx'
import type { ActivityPhase, ActivitySnapshot } from './activity.ts'

export { WorkingLine, type WorkingLineProps } from './WorkingLine.tsx'
export type { ActivityPhase, ActivitySnapshot } from './activity.ts'

/** Required services for the dock registration. */
export const inject = ['slots']

/**
 * Client plugin body: the working-line dock entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
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
