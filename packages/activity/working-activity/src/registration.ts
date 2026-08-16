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
 * (the CLI tree the persistence backend resolves from). Each anchor covers
 * its own tree's top-level copy, then walks one edge further — through
 * `@deepseek-ai/dsh-session-persistence`'s own resolution — because the
 * strict validators (persistence load / resume seed checks) consult the
 * copy THEY resolve, a third physical copy under nested or split-tree
 * layouts that neither anchor's top-level resolution can reach. Copies are
 * deduped by realpath; a copy that cannot be resolved from an anchor simply
 * is not there; registration never throws.
 *
 * Self-adjusting per the compat house rules: when upstream's generated
 * catalog adopts `activity/status` (or a real registration API ships), the
 * add() calls are no-ops and this module can be deleted.
 * @module dsh-working-activity/registration
 */
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'

/** The session-event type this plugin publishes. */
const ACTIVITY_EVENT_TYPE = 'activity/status'

/** The package whose own resolution chain leads to the validators' dsh-session copy. */
const PERSISTENCE_PACKAGE = '@deepseek-ai/dsh-session-persistence'
const SESSION_PACKAGE = '@deepseek-ai/dsh-session'

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
  /** Realpaths already registered — split trees symlink heavily, and require caches by realpath. */
  const registered = new Set<string>()
  for (const anchor of anchors) {
    let req: NodeRequire
    try {
      req = createRequire(anchor)
    } catch {
      continue // Anchor not on disk (e.g. no argv[1] under some runners) — skip.
    }
    registerSessionCopy(req, registered)
    // The validator edge: persistence's load()/resume seed checks consult
    // THEIR OWN resolved dsh-session copy — a third physical copy under
    // nested/split-tree layouts (CLI/profile split, rc.5↔rc.6 upgrade
    // windows, pnpm nesting) that the anchor's top-level resolution misses.
    try {
      const persistenceReq = createRequire(req.resolve(PERSISTENCE_PACKAGE))
      registerSessionCopy(persistenceReq, registered)
    } catch {
      // No persistence package reachable from this anchor — nothing more to cover.
    }
  }
}

/**
 * Register into the dsh-session copy resolved by `req`, once per realpath.
 * @param req - require anchored at the tree (or nested package) to probe.
 * @param registered - realpaths already handled in this registration pass.
 */
function registerSessionCopy(req: NodeRequire, registered: Set<string>): void {
  try {
    const resolved = req.resolve(SESSION_PACKAGE)
    let key = resolved
    try {
      key = realpathSync(resolved)
    } catch {
      // Vanished between resolve and realpath — dedupe by the resolved path.
    }
    if (registered.has(key)) return
    registered.add(key)
    ;(req(resolved) as KnownTypesModule).KNOWN_SESSION_EVENT_TYPES?.add(ACTIVITY_EVENT_TYPE)
  } catch {
    // No resolvable dsh-session copy from this anchor — nothing to register into.
  }
}
