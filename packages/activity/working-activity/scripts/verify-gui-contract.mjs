#!/usr/bin/env node
/**
 * GUI contract gate: can the DeepSeek Harness Tauri desktop GUI
 * (`deepseek-harness-desktop`) load this package's browser half as-is?
 *
 * The desktop GUI is a Tauri shell around the *official* DSH web client: the
 * chat surface is an iframe served by the installed core, so a plugin's
 * client half is loaded by the same `dsh-client-modules` lazy-CJS module table
 * as the plain Web UI. The GUI does not ship a second module table. This gate
 * therefore checks the boundary between the two repos statically:
 *
 * 1. Package declaration — `dsh.client.platform` is `web`, `exports["./client"]`
 *    points at a bundle that exists, the bundle is a single
 *    `window.__ModuleLoader__.load({ id, factory })` registration, and the host
 *    half ships a `dsh.bundle.patch` row so the GUI profile can compose it.
 * 2. Seed coverage — every module the bundle `require()`s is either a word in
 *    the *installed core's* frozen platform module table or an exact
 *    `dsh.client.external` request. A missing seed word throws at
 *    materialization time.
 * 3. Dock contract — `conversation.input.dock` is declared `kind: list`,
 *    `scope: session` by the core's `dsh-client-ui-conversation`, and the
 *    component's `useProjection` seat exists in `dsh-client-ui-session`.
 * 4. React — the peer range covers both the React the *core web shell* seeds
 *    (where the bundle runs) and the GUI host app's declared React line.
 * 5. GUI side — the desktop's own plugins use the same `dsh.client` /
 *    `platform: 'web'` pipeline, its loader wrapper is the same
 *    `window.__ModuleLoader__.load` format, and its webview loads the core's
 *    `service_url`. Its startup patches must not touch this slot.
 * 6. Runtime gate — the core's plugin-compatibility gate (`engines.dsh` or
 *    every `@deepseek-ai/dsh*` peer, prereleases included) admits the GUI
 *    core version. A denied bundle is skipped/disabled by the core, so the
 *    dock row never appears even though the bundle itself is fine.
 *
 * Everything is read-only and repeatable; no build is executed. The script
 * locates the GUI checkout and installed DSH cores by convention, and can be
 * pointed elsewhere:
 *
 *   DSH_GUI_ROOT=/path/to/deepseek-harness-desktop
 *   DSH_CORE_ROOT=/path/to/@deepseek-ai/dsh        (single candidate)
 *   DSH_CORE_ROOTS=/a/@deepseek-ai/dsh:/b/dsh      (path.delimiter separated)
 *   WA_PACKAGE_ROOT=/copy/of/working-activity      (test hook)
 *
 * Flags:
 *   --json              machine-readable result on stdout
 *   --strict-baseline   fail when the GUI's recommended core version is denied
 *                       by the plugin's runtime requirements (default: warn)
 *   --require-gui       a missing GUI checkout is a failure, not a skip
 *
 * Exit codes: 0 = every available check passed (skips allowed);
 *             1 = a real contract gap was found; 2 = the script itself failed.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = process.env.WA_PACKAGE_ROOT ? resolve(process.env.WA_PACKAGE_ROOT) : resolve(SCRIPT_DIR, '..')
const PACKAGE_JSON = join(PACKAGE_ROOT, 'package.json')
const PLUGIN_NAME = 'dsh-working-activity'
const DOCK_SLOT = 'conversation.input.dock'
const PROJECTION_KEY = 'workingActivity'

const argv = new Set(process.argv.slice(2))
const JSON_OUT = argv.has('--json')
const STRICT_BASELINE = argv.has('--strict-baseline')
const REQUIRE_GUI = argv.has('--require-gui')

const checks = []

function record(status, id, detail, evidence = []) {
  checks.push({ status, id, detail, evidence: evidence.filter(item => item !== undefined && item !== null) })
}

const ok = (id, detail, evidence) => record('ok', id, detail, evidence)
const fail = (id, detail, evidence) => record('fail', id, detail, evidence)
const warn = (id, detail, evidence) => record('warn', id, detail, evidence)
const skip = (id, detail, evidence) => record('skip', id, detail, evidence)

function isDir(path) {
  try {
    return statSync(path).isDirectory()
  }
  catch {
    return false
  }
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  }
  catch {
    return null
  }
}

function readJson(path) {
  const text = readText(path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  }
  catch {
    return null
  }
}

function uniqueRealPaths(paths) {
  const seen = new Set()
  const out = []
  for (const path of paths) {
    try {
      const real = realpathSync(path)
      if (seen.has(real)) continue
      seen.add(real)
      out.push(real)
    }
    catch {
      // A path that does not resolve is not a candidate.
    }
  }
  return out
}

function loadSemver(bases) {
  for (const base of bases) {
    if (!base) continue
    try {
      const require = createRequire(join(base, 'gate-probe.mjs'))
      const semver = require('semver')
      if (semver && typeof semver.satisfies === 'function') return semver
    }
    catch {
      // Try the next resolution base.
    }
  }
  return null
}

/** Extract the frozen `PLATFORM_MODULES` object from a built web-frontend asset. */
function extractSeedTable(assets) {
  const marker = /return\s*\{\s*react\s*:/
  for (const asset of assets) {
    const found = marker.exec(asset.text)
    if (found === null) continue
    const braceStart = asset.text.indexOf('{', found.index)
    if (braceStart < 0) continue
    let depth = 0
    let quote = null
    let braceEnd = -1
    for (let index = braceStart; index < asset.text.length; index += 1) {
      const char = asset.text[index]
      if (quote !== null) {
        if (char === '\\') {
          index += 1
        }
        else if (char === quote) {
          quote = null
        }
        continue
      }
      if (char === '"' || char === '\'' || char === '`') {
        quote = char
        continue
      }
      if (char === '{') {
        depth += 1
      }
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          braceEnd = index
          break
        }
      }
    }
    if (braceEnd < 0) continue
    const inner = asset.text.slice(braceStart + 1, braceEnd)
    const keys = [...inner.matchAll(/(?:^|,)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$.-]*))\s*:/g)]
      .map(match => match[1] ?? match[2] ?? match[3])
    return { keys, file: asset.file, snippet: asset.text.slice(found.index, found.index + 48) }
  }
  return null
}

/** Read the React version string carried by the same minified bundle as the seed table. */
function extractReactVersion(assets) {
  const counts = new Map()
  for (const asset of assets) {
    for (const match of asset.text.matchAll(/version:"((?:18|19)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)"/g)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
    }
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  return ranked[0]?.[0] ?? null
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

/** Read the `conversation.input.dock` declaration from the core's ui-conversation contract. */
function inspectDock(conversationDir) {
  if (!conversationDir) return { ok: false, reason: 'dsh-client-ui-conversation is not installed in this core' }
  const contractPath = join(conversationDir, 'lib/types/client/contract/slots.d.ts')
  const text = readText(contractPath)
  if (text === null) return { ok: false, reason: `missing ${contractPath}` }
  const index = text.indexOf(`'${DOCK_SLOT}'`)
  if (index < 0) return { ok: false, reason: `slot ${DOCK_SLOT} is not declared in ${contractPath}` }
  const block = text.slice(index, index + 500)
  const kind = /kind:\s*'([^']+)'/.exec(block)?.[1] ?? null
  const scope = /scope:\s*'([^']+)'/.exec(block)?.[1] ?? null
  return {
    ok: kind === 'list' && scope === 'session',
    kind,
    scope,
    file: contractPath,
    line: lineOf(text, index),
  }
}

/** The `useProjection` seat the dock component destructures comes from the session standard kit. */
function inspectSessionKit(sessionDir) {
  if (!sessionDir) return { ok: false, reason: 'dsh-client-ui-session is not installed in this core' }
  const file = join(sessionDir, 'lib/types/client/index.d.ts')
  const text = readText(file)
  if (text === null) return { ok: false, reason: `missing ${file}` }
  const index = text.indexOf('useProjection: UseProjection')
  return index < 0
    ? { ok: false, reason: `no useProjection standard seat in ${file}` }
    : { ok: true, file, line: lineOf(text, index) }
}

/** Locate one DSH package inside a core install (both active and backup layouts). */
function corePackageDir(coreRoot, name) {
  const candidates = [
    join(coreRoot, 'node_modules/@deepseek-ai', name),
    join(coreRoot, 'node_modules', name),
  ]
  return candidates.find(candidate => isDir(candidate)) ?? null
}

function inspectCore(coreRoot) {
  const pkg = readJson(join(coreRoot, 'package.json'))
  if (pkg === null || pkg.name !== '@deepseek-ai/dsh') return null
  const assetsDir = (() => {
    const frontend = corePackageDir(coreRoot, 'dsh-web-frontend')
    if (frontend === null) return null
    const nested = join(frontend, 'dist/assets')
    return isDir(nested) ? nested : null
  })()
  const assets = assetsDir === null
    ? []
    : readdirSync(assetsDir)
        .filter(file => file.endsWith('.js'))
        .sort()
        .map(file => ({ file: join(assetsDir, file), text: readText(join(assetsDir, file)) ?? '' }))
  const conversationDir = corePackageDir(coreRoot, 'dsh-client-ui-conversation')
  const sessionDir = corePackageDir(coreRoot, 'dsh-client-ui-session')
  const webAppDir = corePackageDir(coreRoot, 'dsh-web-app')
  const appBootDir = corePackageDir(coreRoot, 'dsh-app-boot')
  const modulesDir = corePackageDir(coreRoot, 'dsh-client-modules')
  return {
    root: coreRoot,
    version: String(pkg.version),
    seed: extractSeedTable(assets),
    reactVersion: extractReactVersion(assets),
    conversationDir,
    sessionDir,
    webAppDir,
    appBootDir,
    modulesDir,
    seedDir: assetsDir,
  }
}

function coreRuntimeGateSource(appBootDir) {
  if (!appBootDir) return null
  const file = join(appBootDir, 'lib/index.js')
  const text = readText(file)
  if (text === null) return null
  return {
    file,
    recognized: text.includes('function evaluatePluginCompatibility') && text.includes('includePrerelease: true'),
    deniesBundles: text.includes('evaluatePluginCompatibility(bundleManifest'),
    deniesRows: /evaluatePluginCompatibility\(manifest, exemptions\)/.test(text),
  }
}

/** Runtime requirements the core's boot gate reads: engines.dsh alone, else every DSH-family peer. */
function pluginRuntimeRequirements(pkg) {
  const enginesRange = pkg.engines?.dsh
  if (typeof enginesRange === 'string' && enginesRange.trim() !== '') {
    return { mode: 'engines.dsh', entries: [['engines.dsh', enginesRange.trim()]] }
  }
  const peers = Object.entries(pkg.peerDependencies ?? {})
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
    .map(([name, range]) => [name, String(range)])
  return { mode: 'peerDependencies', entries: peers }
}

function unmetRuntimeRequirements(version, pkg, semver) {
  const { mode, entries } = pluginRuntimeRequirements(pkg)
  const unmet = []
  for (const [name, rawRange] of entries) {
    let range = rawRange.trim()
    if (['workspace:^', 'workspace:~', 'workspace:*'].includes(range)) range = version
    if (range === '') {
      unmet.push({ name, range: rawRange, reason: 'empty range' })
      continue
    }
    try {
      if (!semver.satisfies(version, range, { includePrerelease: true })) unmet.push({ name, range: rawRange })
    }
    catch {
      unmet.push({ name, range: rawRange, reason: 'invalid range' })
    }
  }
  return { mode, unmet }
}

function extractBundleSpecifiers(source) {
  const specifiers = new Set()
  const patterns = [
    /\brequire\(\s*(["'])([^"']+)\1\s*\)/g,
    /\bimport\(\s*(["'])([^"']+)\1\s*\)/g,
    /\bfrom\s*(["'])([^"']+)\1/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[2])
  }
  return [...specifiers]
}

/**
 * Fallback when `lib/client.js` was not built: value imports from the client
 * sources plus the JSX runtime the shell must answer. Type-only and relative
 * imports are erased by the build and create no module-table request.
 */
function staticRequiredSpecifiers() {
  const required = new Set()
  const dir = join(PACKAGE_ROOT, 'src/client')
  let files = []
  try {
    files = readdirSync(dir).filter(file => /\.(?:ts|tsx)$/.test(file) && !file.endsWith('.d.ts'))
  }
  catch {
    return required
  }
  let hasJsx = false
  for (const file of files) {
    if (file.endsWith('.tsx')) hasJsx = true
    const text = readText(join(dir, file)) ?? ''
    const importPattern = /\bimport\s+(?!type\b)(?:[^'";]+?)\s+from\s*['"]([^'"]+)['"]/g
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.endsWith('.css')) continue
      required.add(specifier)
    }
  }
  if (hasJsx) required.add('react/jsx-runtime')
  return required
}

/** Read the GUI's `catalogs.<name>` block without a YAML dependency. */
function workspaceCatalog(text, name) {
  const block = new RegExp(`^  ${name}:\\n((?:    .*\\n?)*)`, 'm').exec(text)
  if (block === null) return {}
  const entries = {}
  for (const line of block[1].split('\n')) {
    const match = /^\s{4}(?:'([^']+)'|"([^"]+)"|([@\w$./-]+)):\s*(.+?)\s*$/.exec(line)
    if (match === null) continue
    entries[match[1] ?? match[2] ?? match[3]] = match[4]
  }
  return entries
}

function concreteVersion(range, semver) {
  if (!range) return null
  if (semver !== null) {
    try {
      const min = semver.minVersion(range)
      if (min !== null) return min.version
    }
    catch {
      // Fall through to the textual fallback.
    }
  }
  const match = /^[~^]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(range.trim())
  return match?.[1] ?? null
}

function projectRelative(path) {
  return path.startsWith(PACKAGE_ROOT) ? path.slice(PACKAGE_ROOT.length + 1) : path
}

/* -------------------------------------------------------------------------- */
/* 1. The package itself                                                      */
/* -------------------------------------------------------------------------- */

const pkg = readJson(PACKAGE_JSON)
const context = { pkg, bundle: null, requiredSpecifiers: [], requiredSource: 'none', pkgDirNames: [] }

if (pkg === null) {
  fail('plugin.manifest', `${PACKAGE_JSON} is missing or unparsable`)
}
else {
  ok('plugin.manifest', `${pkg.name}@${pkg.version} parsed`, [projectRelative(PACKAGE_JSON)])

  const client = pkg.dsh?.client
  if (client === undefined || typeof client !== 'object') {
    fail('plugin.dsh.client', 'package.json declares no dsh.client object — the core never composes a browser row')
  }
  else if (client.platform !== 'web') {
    fail('plugin.dsh.client', `dsh.client.platform is ${JSON.stringify(client.platform)}; the GUI core only composes 'web'`, [projectRelative(PACKAGE_JSON)])
  }
  else {
    ok('plugin.dsh.client', `dsh.client.platform = web; inject = ${JSON.stringify(client.inject ?? [])}; external = ${JSON.stringify(client.external ?? [])}`, [projectRelative(PACKAGE_JSON)])
  }

  const inject = client?.inject
  const external = client?.external
  if (inject !== undefined) {
    if (!Array.isArray(inject) || inject.some(item => typeof item !== 'string')) {
      fail('plugin.dsh.client.inject', 'dsh.client.inject must be an array of package names')
    }
    else {
      const problematic = inject.filter(item => item.startsWith('.') || item.startsWith('/') || /^[a-z]+:/i.test(item) || item.trim() === '')
      if (problematic.length > 0) {
        fail('plugin.dsh.client.inject', `inject must name packages, got ${JSON.stringify(problematic)}`)
      }
      else {
        ok('plugin.dsh.client.inject', `${inject.length} package edge(s): ${inject.join(', ')} (informational composition edges, not Cordis services)`, [projectRelative(PACKAGE_JSON)])
      }
    }
  }
  if (external !== undefined && (!Array.isArray(external) || external.some(item => typeof item !== 'string'))) {
    fail('plugin.dsh.client.external', 'dsh.client.external must be an array of exact module specifiers')
  }

  const clientExport = pkg.exports?.['./client']
  const clientTarget = typeof clientExport === 'string'
    ? clientExport
    : clientExport?.default ?? clientExport?.import ?? clientExport?.require ?? null
  if (typeof clientTarget !== 'string') {
    fail('plugin.exports', 'package.json has no exports["./client"] target — client-modules rejects the row')
  }
  else {
    const bundlePath = resolve(PACKAGE_ROOT, clientTarget)
    if (!existsSync(bundlePath)) {
      fail('plugin.exports', `exports["./client"] points at ${projectRelative(bundlePath)}, which does not exist — build it first (pnpm run build:client)`, [projectRelative(PACKAGE_JSON)])
    }
    else {
      ok('plugin.exports', `exports["./client"] -> ${projectRelative(bundlePath)}`, [projectRelative(PACKAGE_JSON)])
      const source = readText(bundlePath)
      context.bundle = { path: bundlePath, source }
      const registrations = [...(source ?? '').matchAll(/window\.__ModuleLoader__\.load\(\s*\{\s*id:\s*(["'])([^"']+)\1\s*,\s*factory\s*:/g)]
      if (registrations.length !== 1) {
        fail('plugin.bundle.loader', `expected exactly one window.__ModuleLoader__.load registration, found ${registrations.length}`, [projectRelative(bundlePath)])
      }
      else if (registrations[0][2] !== PLUGIN_NAME) {
        fail('plugin.bundle.loader', `loader entry id is ${JSON.stringify(registrations[0][2])}, expected ${JSON.stringify(PLUGIN_NAME)}`, [projectRelative(bundlePath)])
      }
      else {
        ok('plugin.bundle.loader', `single closure-factory registration for ${PLUGIN_NAME}`, [projectRelative(bundlePath)])
      }
      context.requiredSpecifiers = extractBundleSpecifiers(source ?? '')
      context.requiredSource = 'built lib/client.js'
      const cssInjected = /createElement\(\s*["']style["']\s*\)/.test(source ?? '') && /dataset\.plugin/.test(source ?? '')
      if (cssInjected) {
        ok('plugin.bundle.css', 'CSS Modules are inlined and injected as a <style data-plugin> tag inside the factory', [projectRelative(bundlePath)])
      }
      else {
        warn('plugin.bundle.css', 'no <style data-plugin> injection found in the bundle; verify CSS Modules shipping for this build', [projectRelative(bundlePath)])
      }
    }
  }

  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string') {
    fail('plugin.bundle.patch', 'package.json declares no dsh.bundle.patch — the GUI profile cannot compose the host half')
  }
  else {
    const patchPath = resolve(PACKAGE_ROOT, patch)
    const patchText = readText(patchPath)
    if (patchText === null) {
      fail('plugin.bundle.patch', `dsh.bundle.patch points at ${projectRelative(patchPath)}, which does not exist`)
    }
    else if (!patchText.includes(`'${PLUGIN_NAME}'`) && !patchText.includes(`"${PLUGIN_NAME}"`)) {
      fail('plugin.bundle.patch', `${projectRelative(patchPath)} does not mount ${PLUGIN_NAME}`, [projectRelative(patchPath)])
    }
    else {
      ok('plugin.bundle.patch', `bundle layer mounts ${PLUGIN_NAME}`, [projectRelative(patchPath)])
    }
  }

  const indexSource = readText(join(PACKAGE_ROOT, 'src/client/index.ts')) ?? ''
  if (/conversation\.input\.dock/.test(indexSource) && /export const inject = \['slots'\]/.test(indexSource) && /registrant:\s*'dsh-working-activity'/.test(indexSource)) {
    ok('plugin.client.dock', `${DOCK_SLOT} registration and inject: ['slots'] present`, ['src/client/index.ts'])
  }
  else {
    fail('plugin.client.dock', `src/client/index.ts no longer registers ${DOCK_SLOT} with inject: ['slots']`, ['src/client/index.ts'])
  }
  const activitySource = readText(join(PACKAGE_ROOT, 'src/client/activity.ts')) ?? ''
  if (activitySource.includes(`'${PROJECTION_KEY}'`)) {
    ok('plugin.client.projection', `projection key "${PROJECTION_KEY}" declared in the client contract`, ['src/client/activity.ts'])
  }
  else {
    fail('plugin.client.projection', `src/client/activity.ts no longer pins "${PROJECTION_KEY}"`, ['src/client/activity.ts'])
  }

  if (context.bundle === null) {
    const fallback = staticRequiredSpecifiers()
    context.requiredSpecifiers = [...fallback]
    context.requiredSource = 'static source fallback (bundle missing)'
    if (fallback.size > 0) {
      skip('plugin.bundle.specifiers', `bundle not built; using static source imports: ${[...fallback].join(', ')}`)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 2. The GUI checkout                                                        */
/* -------------------------------------------------------------------------- */

const guiDefault = resolve(PACKAGE_ROOT, '../../../../deepseek-harness-desktop')
const guiRoot = process.env.DSH_GUI_ROOT ? resolve(process.env.DSH_GUI_ROOT) : guiDefault
const gui = { root: guiRoot, pkg: null, dshCatalog: {}, runtimeCatalog: {}, recommended: null, minimum: null, reactRange: null, reactVersion: null }

if (!isDir(guiRoot)) {
  const detail = `GUI checkout not found at ${guiRoot}; set DSH_GUI_ROOT to enable GUI-side checks`
  if (REQUIRE_GUI) fail('gui.root', detail)
  else skip('gui.root', detail)
}
else {
  gui.pkg = readJson(join(guiRoot, 'package.json'))
  gui.ok = gui.pkg !== null
  if (gui.pkg === null) {
    fail('gui.root', `${join(guiRoot, 'package.json')} is missing or unparsable`)
  }
  else {
    ok('gui.root', `${gui.pkg.name}@${gui.pkg.version} at ${guiRoot}`, ['package.json'])
  }

  const workspace = readText(join(guiRoot, 'pnpm-workspace.yaml')) ?? ''
  gui.dshCatalog = workspaceCatalog(workspace, 'dsh')
  gui.runtimeCatalog = workspaceCatalog(workspace, 'runtime')
  gui.reactRange = gui.runtimeCatalog.react ?? null
  const cohort = Object.entries(gui.dshCatalog).filter(([name]) => name.startsWith('@deepseek-ai/dsh-client-ui-'))
  const cohortVersions = [...new Set(cohort.map(([, version]) => version))]
  if (cohort.length > 0) {
    ok('gui.catalog', `dsh client cohort (${cohort.length} client-ui packages at ${cohortVersions.join(', ')}) is dev/typecheck-only; host react = ${gui.reactRange ?? 'unknown'}`, ['pnpm-workspace.yaml'])
  }
  else {
    warn('gui.catalog', 'could not read the DSH client cohort from pnpm-workspace.yaml catalogs.dsh', ['pnpm-workspace.yaml'])
  }

  const manifestText = readText(join(guiRoot, 'src-tauri/resources/manifest.jsonc')) ?? ''
  gui.recommended = /"recommend"\s*:\s*"([^"]+)"/.exec(manifestText)?.[1] ?? null
  gui.minimum = /"minimum"\s*:\s*"([^"]+)"/.exec(manifestText)?.[1] ?? null
  if (gui.recommended !== null) {
    ok('gui.baseline', `GUI resource manifest recommends DSH ${gui.recommended} (minimum ${gui.minimum ?? 'unknown'})`, ['src-tauri/resources/manifest.jsonc'])
  }
  else {
    warn('gui.baseline', 'could not read the recommended DSH core version from src-tauri/resources/manifest.jsonc')
  }

  const guiPlugins = ['dsh-tauri', 'dsh-tauri-ui', 'dsh-tauri-worktree', 'dsh-tauri-experimental']
    .map(name => ({ name, manifest: readJson(join(guiRoot, 'packages', name, 'package.json')) }))
    .filter(entry => entry.manifest !== null)
  const webRows = guiPlugins.filter(entry => entry.manifest.dsh?.client?.platform === 'web')
  if (webRows.length === 0) {
    fail('gui.client.platform', 'none of the GUI plugin packages declares dsh.client.platform = web')
  }
  else {
    ok('gui.client.platform', `GUI plugins use the same dsh.client pipeline: ${webRows.map(entry => `${entry.name} (${(entry.manifest.dsh.client.inject ?? []).length} inject edges)`).join(', ')}`, webRows.map(entry => `packages/${entry.name}/package.json`))
  }

  const wrapper = readText(join(guiRoot, 'packages/dsh-tauri-tsdown/src/index.ts'))
  if (wrapper === null) {
    warn('gui.loader', 'packages/dsh-tauri-tsdown/src/index.ts not found; cannot confirm the GUI uses the same loader wrapper')
  }
  else if (wrapper.includes('window.__ModuleLoader__.load') && wrapper.includes('react/jsx-runtime')) {
    ok('gui.loader', 'GUI client bundles use the same window.__ModuleLoader__.load closure-factory + platform externals as this package', ['packages/dsh-tauri-tsdown/src/index.ts'])
  }
  else {
    warn('gui.loader', 'GUI loader wrapper no longer matches the closure-factory/externals contract', ['packages/dsh-tauri-tsdown/src/index.ts'])
  }

  const iframeSource = readText(join(guiRoot, 'src/layout/components/iframe.tsx')) ?? ''
  const harnessStore = readText(join(guiRoot, 'src/store/modules/harness/store.ts')) ?? ''
  if (iframeSource.includes('harness.iframeSrc') && harnessStore.includes('service_url')) {
    ok('gui.webview', 'chat surface is the core web client in an iframe; iframe src is the core service_url (one module table, not a GUI-owned one)', ['src/layout/components/iframe.tsx', 'src/store/modules/harness/store.ts'])
  }
  else {
    warn('gui.webview', 'could not confirm that the GUI webview loads the core service_url; the module-table analysis assumes it does', ['src/layout/components/iframe.tsx', 'src/store/modules/harness/store.ts'])
  }

  const patchDir = join(guiRoot, 'src-tauri/src/service/patch')
  const patchFiles = isDir(patchDir) ? readdirSync(patchDir).filter(file => file.endsWith('.rs')).sort() : []
  const dockPatches = patchFiles.filter((file) => {
    const text = readText(join(patchDir, file)) ?? ''
    return text.includes('input.dock') || text.includes('conversation.input')
  })
  if (patchFiles.length === 0) {
    warn('gui.patches', 'GUI startup patch directory not found; cannot confirm it leaves the dock alone')
  }
  else if (dockPatches.length > 0) {
    warn('gui.patches', `GUI startup patches touch the dock surface: ${dockPatches.join(', ')}; re-verify slot coexistence`, dockPatches.map(file => `src-tauri/src/service/patch/${file}`))
  }
  else {
    ok('gui.patches', `GUI startup patches (${patchFiles.length}) target other client surfaces; none touches conversation.input.dock`, patchFiles.map(file => `src-tauri/src/service/patch/${file}`))
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Installed DSH cores                                                     */
/* -------------------------------------------------------------------------- */

function discoverCoreRoots() {
  const explicit = [
    process.env.DSH_CORE_ROOT,
    ...(process.env.DSH_CORE_ROOTS ? process.env.DSH_CORE_ROOTS.split(delimiter) : []),
  ].filter(Boolean).map(path => resolve(path))
  if (explicit.length > 0) return uniqueRealPaths(explicit)

  const candidates = []
  const active = join(homedir(), '.dsh-runtime/npm/lib/node_modules/@deepseek-ai/dsh')
  if (isDir(active)) candidates.push(active)
  const backups = join(homedir(), '.dsh-runtime/backups')
  if (isDir(backups)) {
    for (const name of readdirSync(backups).sort()) {
      const candidate = join(backups, name)
      if (!isDir(candidate)) continue
      const candidatePkg = readJson(join(candidate, 'package.json'))
      if (candidatePkg !== null && candidatePkg.name === '@deepseek-ai/dsh') candidates.push(candidate)
    }
  }
  return uniqueRealPaths(candidates)
}

const coreRoots = discoverCoreRoots()
const cores = coreRoots.map(inspectCore).filter(core => core !== null)
const semver = loadSemver([
  ...cores.map(core => core.root),
  guiRoot,
  PACKAGE_ROOT,
])

if (cores.length === 0) {
  skip('core.installed', 'no installed @deepseek-ai/dsh core found; set DSH_CORE_ROOT to verify seed/dock coverage against one')
}
else if (semver === null) {
  warn('core.semver', 'no semver implementation resolvable from the GUI/core installs; runtime-gate and React checks are heuristic')
}

const requiredSpecifiers = context.requiredSpecifiers ?? []
const declaredExternal = new Set(context.pkg?.dsh?.client?.external ?? [])

for (const core of cores) {
  const label = `DSH ${core.version}`

  if (core.seed === null) {
    warn(`core.${core.version}.seed`, `${label}: no built dsh-web-frontend asset with a PLATFORM_MODULES table found under ${core.root}; seed coverage unverified`)
  }
  else {
    const seed = new Set(core.seed.keys)
    const missing = requiredSpecifiers.filter(specifier => !seed.has(specifier) && !declaredExternal.has(specifier))
    const evidence = [`${core.seed.file} (${core.seed.snippet})`]
    if (missing.length === 0) {
      ok(`core.${core.version}.seed`, `${label}: seed table (${core.seed.keys.length} words) covers ${requiredSpecifiers.length === 0 ? 'the bundle (no requires)' : requiredSpecifiers.map(specifier => JSON.stringify(specifier)).join(', ')}`, evidence)
    }
    else {
      fail(`core.${core.version}.seed`, `${label}: ${missing.map(specifier => JSON.stringify(specifier)).join(', ')} not in the frozen module table — materialization throws "missed the module table"`, evidence)
    }

    if (core.reactVersion !== null && typeof context.pkg?.peerDependencies?.react === 'string') {
      if (semver === null) {
        warn(`core.${core.version}.react`, `${label}: embedded React ${core.reactVersion} found but semver is unavailable; peer coverage unverified`)
      }
      else if (semver.satisfies(core.reactVersion, context.pkg.peerDependencies.react)) {
        ok(`core.${core.version}.react`, `${label}: embedded web-shell React ${core.reactVersion} is covered by peer ${context.pkg.peerDependencies.react}`, evidence)
      }
      else {
        fail(`core.${core.version}.react`, `${label}: embedded web-shell React ${core.reactVersion} is outside peer range ${context.pkg.peerDependencies.react}`, evidence)
      }
    }
    else {
      warn(`core.${core.version}.react`, `${label}: could not detect the web shell's React version from the frontend asset`)
    }
  }

  const dock = inspectDock(core.conversationDir)
  if (dock.ok) {
    ok(`core.${core.version}.dock`, `${label}: ${DOCK_SLOT} is kind=${dock.kind}, scope=${dock.scope}`, [`${dock.file}:${dock.line}`])
  }
  else {
    fail(`core.${core.version}.dock`, `${label}: ${dock.reason}`, [dock.file])
  }

  const session = inspectSessionKit(core.sessionDir)
  if (session.ok) {
    ok(`core.${core.version}.session`, `${label}: session standard kit exposes useProjection (the dock component's data seat)`, [`${session.file}:${session.line}`])
  }
  else {
    fail(`core.${core.version}.session`, `${label}: ${session.reason}`, [session.file])
  }

  const inject = context.pkg?.dsh?.client?.inject ?? []
  if (inject.length > 0 && core.webAppDir !== null) {
    const rowResults = inject.map((name) => {
      const dir = corePackageDir(core.root, name)
      if (dir === null) return { name, ok: false, reason: 'package is not installed in this core (seed-only or missing row)' }
      const manifest = readJson(join(dir, 'package.json'))
      const platform = manifest?.dsh?.client?.platform ?? null
      if (platform !== 'web') return { name, ok: false, reason: `dsh.client.platform = ${platform ?? 'none'}` }
      return { name, ok: true, version: manifest.version }
    })
    const broken = rowResults.filter(result => !result.ok)
    if (broken.length === 0) {
      const webAppPatch = readText(join(core.webAppDir, 'cordis.patch.yml')) ?? ''
      const edgeWarning = rowResults.filter(result => !webAppPatch.includes(`'${result.name}'`))
      if (edgeWarning.length === 0) {
        ok(`core.${core.version}.inject`, `${label}: inject edges name real web boot rows: ${rowResults.map(result => `${result.name}@${result.version}`).join(', ')}`, ['node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml'])
      }
      else {
        warn(`core.${core.version}.inject`, `${label}: inject edges not found in dsh-web-app's composition: ${edgeWarning.map(result => result.name).join(', ')} (the dependency edge is silently inert)`)
      }
    }
    else {
      fail(`core.${core.version}.inject`, `${label}: dsh.client.inject names packages that are not web boot rows: ${broken.map(result => `${result.name} (${result.reason})`).join(', ')}`)
    }
  }

  const gate = coreRuntimeGateSource(core.appBootDir)
  if (gate === null) {
    warn(`core.${core.version}.gate`, `${label}: dsh-app-boot not found; runtime compatibility gate unknown`)
  }
  else {
    if (!gate.recognized) {
      warn(`core.${core.version}.gate`, `${label}: dsh-app-boot no longer matches the expected peer-gate implementation; gate simulation may be stale`, [`${gate.file}`])
    }
    if (semver === null) {
      warn(`core.${core.version}.gate`, `${label}: semver unavailable; runtime requirements not evaluated`)
    }
    else {
      const { mode, unmet } = unmetRuntimeRequirements(core.version, context.pkg ?? {}, semver)
      if (unmet.length === 0) {
        ok(`core.${core.version}.gate`, `${label}: runtime requirements (${mode}) admit this core`, [gate.file])
      }
      else {
        const denied = gate.deniesBundles || gate.deniesRows
        const detail = `${label}: ${denied ? 'the core gate denies/skips the plugin' : 'runtime requirements may deny the plugin'}: `
          + unmet.map(item => `${item.name} ${item.range}`).join('; ')
        // A denied *backup* core is a supported-line limitation, not a failure
        // when another detected core is admitted. The summary decides.
        warn(`core.${core.version}.gate`, detail, [gate.file])
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 4. React 19 on the GUI host app                                            */
/* -------------------------------------------------------------------------- */

if (gui.ok) {
  const reactRange = context.pkg?.peerDependencies?.react
  const hostReact = concreteVersion(gui.reactRange, semver)
  if (typeof reactRange !== 'string') {
    fail('gui.host.react', 'package.json declares no react peer range')
  }
  else if (hostReact === null) {
    warn('gui.host.react', `could not resolve the GUI host React from catalog range ${JSON.stringify(gui.reactRange)}`)
  }
  else if (semver === null) {
    warn('gui.host.react', `GUI host React ${hostReact} found but semver is unavailable; peer coverage unverified`)
  }
  else if (semver.satisfies(hostReact, reactRange)) {
    ok('gui.host.react', `GUI host React ${hostReact} is covered by peer ${reactRange} (host Tauri UI only; the plugin runs in the core web shell)`)
  }
  else {
    fail('gui.host.react', `GUI host React ${hostReact} is outside react peer range ${reactRange}`)
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Runtime-gate summary                                                    */
/* -------------------------------------------------------------------------- */

if (cores.length > 0 && semver !== null) {
  const admitted = cores.filter(core => unmetRuntimeRequirements(core.version, context.pkg ?? {}, semver).unmet.length === 0)
  const denied = cores.filter(core => !admitted.includes(core))
  if (admitted.length === 0) {
    fail('runtime.admitted', `no detected GUI core version is admitted by runtime requirements: ${denied.map(core => core.version).join(', ')}`)
  }
  else {
    ok('runtime.admitted', `admitted core version(s): ${admitted.map(core => core.version).join(', ')}${denied.length > 0 ? `; denied: ${denied.map(core => core.version).join(', ')}` : ''}`)
  }
}

if (gui.ok && gui.recommended !== null && semver !== null) {
  const { mode, unmet } = unmetRuntimeRequirements(gui.recommended, context.pkg ?? {}, semver)
  if (unmet.length === 0) {
    ok('gui.baseline.gate', `GUI recommended core ${gui.recommended} is admitted (${mode})`)
  }
  else {
    const detail = `GUI recommended core ${gui.recommended} is denied (${mode}): ${unmet.map(item => `${item.name} ${item.range}`).join('; ')}`
    if (STRICT_BASELINE) fail('gui.baseline.gate', detail)
    else warn('gui.baseline.gate', `${detail} — rerun with --strict-baseline to make this a hard failure`)
  }
}

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

const summary = {
  ok: checks.filter(check => check.status === 'ok').length,
  warn: checks.filter(check => check.status === 'warn').length,
  fail: checks.filter(check => check.status === 'fail').length,
  skip: checks.filter(check => check.status === 'skip').length,
}

if (JSON_OUT) {
  process.stdout.write(`${JSON.stringify({
    ok: summary.fail === 0,
    package: pkg ? { name: pkg.name, version: pkg.version } : null,
    gui: gui.ok ? { root: gui.root, version: gui.pkg?.version ?? null, recommended: gui.recommended } : null,
    cores: cores.map(core => ({ version: core.version, root: core.root })),
    requiredSpecifiers,
    requiredSource: context.requiredSource,
    checks,
    summary,
  }, null, 2)}\n`)
}
else {
  const statusLabel = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' }
  console.log(`verify-gui-contract: ${context.pkg ? `${context.pkg.name}@${context.pkg.version}` : PACKAGE_ROOT}`)
  console.log(`  GUI:  ${gui.ok ? `${gui.pkg.name}@${gui.pkg.version} (${gui.root})` : `skipped (${gui.root})`}`)
  console.log(`  core: ${cores.length === 0 ? 'none found' : cores.map(core => core.version).join(', ')}`)
  console.log(`  need: ${requiredSpecifiers.length === 0 ? 'no module requests' : requiredSpecifiers.map(specifier => JSON.stringify(specifier)).join(', ')} [${context.requiredSource}]`)
  console.log('')
  for (const check of checks) {
    console.log(`  [${statusLabel[check.status]}] ${check.id}: ${check.detail}`)
    for (const evidence of check.evidence) console.log(`         ${evidence}`)
  }
  console.log('')
  console.log(
    `verify-gui-contract: ${summary.fail === 0 ? 'OK' : 'FAIL'} `
    + `(${summary.ok} ok, ${summary.warn} warning(s), ${summary.skip} skipped, ${summary.fail} failed)`,
  )
  if (summary.fail > 0) {
    console.log('')
    console.log('Fix the FAIL entries above before claiming GUI support; warnings are documented limitations.')
  }
}

process.exitCode = summary.fail === 0 ? 0 : 1
