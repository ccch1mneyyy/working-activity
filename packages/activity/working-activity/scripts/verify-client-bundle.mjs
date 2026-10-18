#!/usr/bin/env node
/**
 * Verification: the built Web client bundle (`lib/client.js`) is the artifact
 * the browser shell can actually load — no browser is required, and every
 * assertion below runs against the real emitted file.
 *
 * Four layers, all against the built bundle and the package declaration it
 * ships with:
 *
 * 1. Declared client row — `package.json`'s `dsh.client` still selects
 *    `platform: 'web'` (the WebUI and the Tauri GUI share it) and injects
 *    exactly the real RC2 boot rows (conversation / renderer / session).
 *    `dsh-client-ui-slots` is a platform seed, not a row: injecting it would
 *    name a package the boot graph never composes.
 * 2. Loader contract — exactly one
 *    `window.__ModuleLoader__.load({ id: 'dsh-working-activity', factory })`
 *    registration, evaluated against a stub `window`.
 * 3. Bundle purity — every `require(...)` / `import(...)` / `from '...'`
 *    specifier must be an RC2 platform seed word. The seed oracle is pinned
 *    below from the shipped RC2 frontend asset and cross-checked against
 *    `tsdown.config.ts` (its `PLATFORM_MODULES`), so neither the build's
 *    externals table nor the artifact can silently drift off the shell's
 *    frozen module table; anything else means a cross-plugin value import or
 *    host-only code leaked into the browser bundle.
 * 4. Dock registration + render contract — the entry runs under a stub cordis
 *    context whose `slots` face delegates to the real RC2 `SlotCore` shipped by
 *    `dsh-client-ui-slots` (no DOM, no React renderer): it waits for the
 *    `conversation.input.dock` declaration, registers id `activity` / order 15
 *    / registrant `dsh-working-activity`, sits between goal 10 and queue 20,
 *    and the exported component reads `useProjection('workingActivity')` and
 *    returns `null` for an absent value, an idle phase, or an empty line.
 *
 * Usage: node scripts/verify-client-bundle.mjs [bundlePath]
 * The optional path exists for the failure-mode check (point it at a mutated
 * copy); `pnpm run verify:client-bundle` rebuilds first and then runs this
 * against `lib/client.js`. Exits non-zero on any assertion failure.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))
const BUNDLE_ID = 'dsh-working-activity'
const SLOT_KEY = 'conversation.input.dock'
const PROJECTION_KEY = 'workingActivity'

// --- 1. The RC2 seed table the bundle is allowed to require ----------------
// Source: @deepseek-ai/dsh-web-frontend@0.2.1-rc.2,
// dist/assets/index-CN7NIWNw.js:190 — `function SZ(){return{...}}`, the web
// shell's static module table. This copy is the independent oracle: the build
// table must agree with it and every emitted specifier must land in it.
const RC2_SEED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const configSource = await readFile(resolve(PACKAGE_ROOT, 'tsdown.config.ts'), 'utf8')
const seedBlock = /const PLATFORM_MODULES = \[([\s\S]*?)\]\s*as const/.exec(configSource)
assert.ok(seedBlock, 'tsdown.config.ts no longer declares a PLATFORM_MODULES array literal')
const SEEDS = [...seedBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1])
assert.deepEqual(
  [...SEEDS].sort(),
  [...RC2_SEED_MODULES].sort(),
  'tsdown.config.ts PLATFORM_MODULES drifted from the RC2 web shell seed table '
  + `(${RC2_SEED_MODULES.join(', ')}); retired seeds must leave, and new seeds need evidence`,
)

// --- 2. The package's declared client row --------------------------------
const packageManifest = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'))
const clientDeclaration = packageManifest.dsh?.client
assert.ok(clientDeclaration !== undefined, 'package.json must declare dsh.client for the web surface')
assert.equal(
  clientDeclaration.platform, 'web',
  'dsh.client.platform must stay "web" — the WebUI and the Tauri GUI share this entry',
)

/**
 * RC2 boot rows this bundle contributes into: the conversation plugin declares
 * `conversation.input.dock`, the renderer provides the `slots` service, and
 * the session plugin ships the `useProjection` standard seat. Each is a real
 * `dsh.client` package row; ordering here is informational (see
 * @deepseek-ai/dsh-package-manifest DshClientManifest.inject).
 */
const BOOT_ROWS = [
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-session',
]
assert.deepEqual(
  [...(clientDeclaration.inject ?? [])].sort(),
  [...BOOT_ROWS].sort(),
  'dsh.client.inject must name exactly the RC2 boot rows (conversation/renderer/session)',
)
assert.ok(
  !(clientDeclaration.inject ?? []).includes('@deepseek-ai/dsh-client-ui-slots'),
  'dsh-client-ui-slots declares no dsh.client row — injecting it would compose a nonexistent boot row',
)

const packageRequire = createRequire(resolve(PACKAGE_ROOT, 'package.json'))
for (const row of BOOT_ROWS) {
  const rowPath = packageRequire.resolve(`${row}/package.json`)
  const rowManifest = JSON.parse(await readFile(rowPath, 'utf8'))
  assert.equal(
    rowManifest.dsh?.client?.platform, 'web',
    `${row} is injected as a boot row but does not declare dsh.client.platform "web"`,
  )
}
const slotsManifestPath = packageRequire.resolve('@deepseek-ai/dsh-client-ui-slots/package.json')
const slotsManifest = JSON.parse(await readFile(slotsManifestPath, 'utf8'))
assert.equal(
  slotsManifest.dsh?.client, undefined,
  'dsh-client-ui-slots now declares dsh.client — re-check whether it became a boot row before injecting it',
)

// --- 3. The built bundle --------------------------------------------------
const bundlePath = resolve(PACKAGE_ROOT, process.argv[2] ?? 'lib/client.js')
assert.ok(
  existsSync(bundlePath),
  `${bundlePath} is missing — run \`pnpm run build:client\` first (the pnpm script does)`,
)
const source = await readFile(bundlePath, 'utf8')

// Every module reference in the emitted file, whatever form it takes: the
// bundle is CJS (require) but the check must not go blind if the format moves.
const specifiers = new Set()
const SPECIFIER_PATTERNS = [
  /\brequire\(\s*(["'])([^"']+)\1\s*\)/g,
  /\bimport\(\s*(["'])([^"']+)\1\s*\)/g,
  /\bfrom\s*(["'])([^"']+)\1/g,
]
for (const pattern of SPECIFIER_PATTERNS) {
  for (const match of source.matchAll(pattern)) specifiers.add(match[2])
}
assert.ok(specifiers.size > 0, 'the bundle references no module at all — it cannot be the real artifact')
for (const specifier of specifiers) {
  assert.ok(
    RC2_SEED_MODULES.includes(specifier),
    `bundle purity: "${specifier}" is not an RC2 platform seed word — `
    + 'cross-plugin value imports and host-only code must never reach the browser bundle',
  )
}

// --- 4. Loader banner -----------------------------------------------------
const banners = [...source.matchAll(/window\.__ModuleLoader__\.load\(\s*\{\s*id:\s*(["'])([^"']+)\1\s*,\s*factory\s*:/g)]
assert.equal(banners.length, 1, 'the bundle must register exactly one __ModuleLoader__ entry')
assert.equal(banners[0][2], BUNDLE_ID, `the loader entry id must be ${BUNDLE_ID}`)

// --- 5. Evaluate under a stub window + cordis context ---------------------
const registrations = new Map()
const stubWindow = {
  __ModuleLoader__: {
    load(registration) {
      assert.ok(!registrations.has(registration.id), `duplicate loader registration for ${registration.id}`)
      registrations.set(registration.id, registration.factory)
    },
  },
}

// The bundle is the closure-factory artifact; `window` arrives as a parameter
// so nothing leaks into the real global object.
// eslint-disable-next-line no-new-func -- the artifact IS code to evaluate; this gate never runs untrusted input
const evaluate = new Function('window', source)
evaluate(stubWindow)
assert.ok(registrations.has(BUNDLE_ID), `the bundle did not register ${BUNDLE_ID}`)

const require = createRequire(import.meta.url)
const requireCalls = []
const loaderRequire = (specifier) => {
  requireCalls.push(specifier)
  assert.ok(RC2_SEED_MODULES.includes(specifier), `runtime require("${specifier}") is not an RC2 platform seed word`)
  return require(specifier)
}
const client = registrations.get(BUNDLE_ID)(loaderRequire)

assert.equal(typeof client.apply, 'function', 'the entry must export apply(ctx)')
assert.deepEqual(client.inject, ['slots'], 'the entry must inject the slots service')
assert.equal(typeof client.WorkingLine, 'function', 'the entry must export the dock component')

// --- 6. Dock registration against the real RC2 SlotCore -------------------
// SlotRegistry (ui-renderer) is a cordis Service over this pure registry; the
// artifact is driven through SlotCore directly so the gate exercises the
// shipped load-time contract instead of a hand-written recorder: undeclared
// targets defer, list entries need an `id`, list rendering order is ascending
// `order`, and a declaration collapse removes its entries.
const core = new SlotCore()
const injected = []
const pendingInjections = []
const stubContext = {
  slots: {
    inject(key, callback) {
      injected.push(key)
      let active
      const install = () => {
        active = callback()
        assert.equal(typeof active, 'function', `slots.inject(${key}) must return the register disposer`)
      }
      if (core.specDynamic(key) !== undefined) install()
      else pendingInjections.push({ key, install })
      return () => {
        if (active !== undefined) active()
      }
    },
    register(options, component) {
      return core.register(options, component)
    },
  },
}
client.apply(stubContext)

assert.deepEqual(injected, [SLOT_KEY], `the entry must wait for the ${SLOT_KEY} declaration exactly once`)
assert.equal(pendingInjections.length, 1, 'the dock entry must defer until the slot declaration lands')
assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, 'nothing may register into an undeclared dock')

// The conversation package declares the dock as a list slot in session scope
// (ui-conversation lib/types/client/contract/slots.d.ts). The gate declares the
// same shape on the built-in root seat, then releases the pending injection the
// way SlotRegistry.inject would.
const declarationDisposer = core.register({
  name: 'root',
  children: { [SLOT_KEY]: { kind: 'list', scope: 'session' } },
}, () => null)
assert.equal(core.specDynamic(SLOT_KEY)?.kind, 'list', 'the dock slot must be a list slot')
assert.equal(core.specDynamic(SLOT_KEY)?.scope, 'session', 'the dock slot must be session-scoped')
for (const pending of pendingInjections) pending.install()

// RC2 ships goal at order 10 and queue at order 20 in this dock; the real list
// ordering must place this row between them.
const noop = () => null
const goalDisposer = core.register({ name: SLOT_KEY, id: 'goal', order: 10 }, noop)
const queueDisposer = core.register({ name: SLOT_KEY, id: 'queue', order: 20 }, noop)
const docked = core.entriesOfSlot(SLOT_KEY)
assert.deepEqual(
  docked.map(candidate => candidate.options.id),
  ['goal', 'activity', 'queue'],
  'the dock entry must keep order 15 (between goal 10 and queue 20)',
)
const entry = docked.find(candidate => candidate.options.id === 'activity')
assert.ok(entry !== undefined, 'the activity entry must be live in the dock')
assert.equal(entry.options.order, 15, 'the dock entry order must stay 15')
assert.equal(entry.registrant, BUNDLE_ID, `the registrant stamp must be ${BUNDLE_ID}`)
assert.equal(entry.component, client.WorkingLine, 'the registration must mount the exported WorkingLine')

// Disposal cascade: removing siblings leaves this row; collapsing the dock
// declaration removes it, and the stale disposer is a no-op.
queueDisposer()
goalDisposer()
assert.deepEqual(core.entriesOfSlot(SLOT_KEY).map(candidate => candidate.options.id), ['activity'])
declarationDisposer()
assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, 'the declaration collapse must clear the dock entries')

// --- 7. The projection read + render contract (no DOM, no renderer) -------
const calls = []
const readWith = (value) => client.WorkingLine({
  useProjection: (key) => {
    calls.push(key)
    return value
  },
})

assert.equal(readWith(undefined), null, 'an absent projection value must render nothing')
assert.equal(readWith({ phase: 'idle', line: 'idle copy', toolCount: 0 }), null, 'the idle phase must render nothing')
assert.equal(readWith({ phase: 'thinking', line: '', toolCount: 0 }), null, 'an empty line must render nothing')
assert.deepEqual(
  [...new Set(calls)], [PROJECTION_KEY],
  `the component must read the "${PROJECTION_KEY}" projection key and nothing else`,
)

const live = {
  phase: 'tool',
  line: '跑个命令 npm test · 12s',
  toolCount: 2,
  live: true,
  phaseStartedAt: 1,
  turnStartedAt: 1,
  updatedAt: 2,
  lang: 'zh',
}
const element = readWith(live)
assert.ok(element !== null && typeof element === 'object', 'a live value must render an element')
assert.equal(element.type, 'div', 'the row must stay a single div')
assert.equal(element.props['data-activity-phase'], 'tool', 'the phase must drive the CSS hook')
assert.equal(typeof element.props.className, 'string', 'the row must carry its CSS-module class')
const children = element.props.children
assert.ok(Array.isArray(children), 'the row must render its marker, text, and badge as children')
assert.equal(children[0]?.type, 'span', 'the first child must be the phase marker')
assert.equal(children[0]?.props['aria-hidden'], 'true', 'the marker must stay hidden from assistive tech')
assert.equal(children[1]?.props.children, live.line, "the second child must render the host's line verbatim")
assert.equal(children[2]?.props.children, 2, 'a positive tool count must render the badge')
assert.equal(children[2]?.props.title, '2 tools this turn', 'the badge must keep its tooltip copy')

const quiet = readWith({ ...live, toolCount: 0 })
assert.equal(quiet.props.children[2], false, 'a zero tool count must not render the badge')

console.log(
  `verify-client-bundle: OK (platform ${clientDeclaration.platform}; inject ${clientDeclaration.inject.join(', ')}; `
  + `${BUNDLE_ID} registers ${SLOT_KEY}#${entry.options.id} order ${entry.options.order}; `
  + `requires ${[...specifiers].map(s => JSON.stringify(s)).join(', ') || 'nothing'}; `
  + `renders nothing for absent/idle/empty and one row otherwise)`,
)
