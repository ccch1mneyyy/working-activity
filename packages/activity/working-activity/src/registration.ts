/**
 * Runtime registration of the `activity/status` session-event type.
 *
 * dsh-session's read paths (resume seed validation, persistence load)
 * refuse any log containing a type outside KNOWN_SESSION_EVENT_TYPES unless
 * every such event carries the envelope's `ignorable` marker — and
 * `session.append()` exposes no ignorable flag, so this plugin's published
 * snapshots used to make the whole session unresumable (and broke tolerant
 * title reads). Upstream's catalog header defers a registration surface
 * "until such a consumer exists" — this plugin is that consumer, so it
 * registers its own type at load.
 *
 * Why "every reachable copy": a runtime can load dsh-session more than
 * once. The dsh CLI tree and a plugin profile tree resolve different
 * physical copies (e.g. rc.5 vs rc.6 during upgrade windows), and the
 * strict validators consult only THEIR copy's Set. Registering through the
 * plugin's own import alone would leave the validator's copy untouched.
 * Anchors: this module (plugin/profile tree) and the process entry point
 * (the CLI tree the persistence backend resolves from). A copy that cannot
 * be resolved from an anchor simply is not there; registration never throws.
 *
 * Self-adjusting per the compat house rules: when upstream's generated
 * catalog adopts `activity/status` (or a real registration API ships), the
 * add() calls are no-ops and this module can be deleted.
 * @module dsh-working-activity/registration
 */
import { createRequire } from 'node:module'

/** The session-event type this plugin publishes. */
const ACTIVITY_EVENT_TYPE = 'activity/status'

interface KnownTypesModule {
  KNOWN_SESSION_EVENT_TYPES?: Set<string>
}

/**
 * Register `activity/status` as a known session-event type in every
 * reachable dsh-session copy. Idempotent; silently skips anchors whose
 * resolution fails.
 */
export function registerActivityEventType(): void {
  const anchors = [import.meta.url, process.argv[1]].filter(
    (anchor): anchor is string => typeof anchor === 'string' && anchor.length > 0,
  )
  for (const anchor of anchors) {
    try {
      const req = createRequire(anchor)
      const mod = req('@deepseek-ai/dsh-session') as KnownTypesModule
      mod.KNOWN_SESSION_EVENT_TYPES?.add(ACTIVITY_EVENT_TYPE)
    } catch {
      // No resolvable dsh-session copy from this anchor — nothing to register into.
    }
  }
}
