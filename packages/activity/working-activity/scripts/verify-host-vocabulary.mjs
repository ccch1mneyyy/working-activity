#!/usr/bin/env node
/**
 * Verification: the DSH Host vocabulary this plugin is compiled against.
 *
 * Why this gate exists: the plugin reads Host session events and cordis agent
 * events by *name* and reads their payload fields by *path*. Nothing in the
 * plugin's own unit tests notices when a Host line renames `assistant/chunk`,
 * moves the tool-result correlation id off the message, or drops a field from a
 * stream frame — the plugin keeps running, silently renders a dead status line,
 * and the break only shows up in production. This gate re-derives the consumed
 * surfaces from the Host's own generated catalog and `.d.ts` declarations in the
 * tree being inspected, and fails fast when one of them is gone.
 *
 * Two tiers (per Host corridor, see below):
 *
 *   required          the checked tree MUST declare it — missing ⇒ exit 1.
 *   legacy-tolerated  read when present; absence is NOT a failure, because
 *                     another supported corridor names the same concept
 *                     differently (e.g. streaming deltas are the session event
 *                     `assistant/chunk` on the rc.* / alpha.* lines and the
 *                     cordis event `agent/assistant-stream` on the 0.1.7 line).
 *
 * Corridors. The plugin supports several Host lines at once, so a surface can
 * only be "required" relative to the line being checked. The corridor is
 * classified from the tree's *own* session catalog — never from a version
 * string, so a re-tagged release cannot silently change tiers:
 *
 *   chunk-stream    KNOWN_SESSION_EVENT_TYPES has `assistant/chunk`.
 *                   (observed: 0.1.0-rc.6, 0.1.2-alpha.2)
 *   attempt-stream  no `assistant/chunk`, but `assistant/attempt` + the live
 *                   `agent/assistant-stream` frame event.
 *                   (observed: 0.1.7-rc.1/rc.2)
 *
 * A tree that matches neither corridor fails: that is the drift alarm for a new
 * Host line, and the fix is to review this table against the new Host, not to
 * widen the classification silently.
 *
 * Method and its limits (all checks are text-based on the resolved `.d.ts`):
 *  - `KNOWN_SESSION_EVENT_TYPES` is imported from the generated catalog module
 *    inside the resolved `@deepseek-ai/dsh-session` copy — the real Set the
 *    Host's strict read paths consult, not a copy of its contents.
 *  - Payload and frame surfaces are read by locating the declaration (quoted
 *    session-event member, `interface` / `type` alias, member signature) in the
 *    comment-stripped declaration text and matching the member names inside it.
 *    This proves a member exists with that name; it does NOT type-check the
 *    plugin against the Host (that is `tsc`'s job) and it does not follow
 *    `extends` chains beyond one explicit hop nor resolve re-exported aliases.
 *    A renamed-but-equivalent declaration, or a member that moved to another
 *    package, is reported as missing — deliberately, so a human reviews the move.
 *  - Known gap, left open on purpose: the legacy tool-result *block* failure flag
 *    (`content[].isError`) is not a row of its own. The block itself is already
 *    pinned by the correlation row on the legacy line, and a third failure-flag
 *    row would describe the same one-field rename twice.
 *  - This gate reads declarations; it cannot tell whether a surface is *reached*
 *    at runtime on the composition actually mounted. The unit/integration suites
 *    own that half.
 *
 * Usage:
 *   node scripts/verify-host-vocabulary.mjs [--tree <dir>]
 *
 *   --tree <dir>  Tree whose `node_modules` resolves the Host packages.
 *                 Default: this script's own package. Point it at a
 *                 compatibility fixture to check that corridor's Host line.
 *
 * Exit codes: 0 all required surfaces present; 1 anything missing, the tree
 * unresolvable, or the corridor unrecognized.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

const HOST_PACKAGES = {
  session: '@deepseek-ai/dsh-session',
  llm: '@deepseek-ai/dsh-llm',
  agent: '@deepseek-ai/dsh-agent',
}

/** Session event types the tracker switches on. */
const TRACKED_SESSION_EVENTS = ['tool/result', 'tool/call', 'assistant/message', 'turn/start', 'turn/end', 'step/start']

/**
 * Tier of one row on one corridor. `required` fails the run when the surface is
 * absent; `legacy-tolerated` accepts absence (see the header comment). The
 * three shapes below are the whole vocabulary of the table:
 *
 *   EVERY_CORRIDOR  the surface survived the rename and must exist everywhere
 *   LEGACY_LINE     only the rc.* / alpha.* lines ship it
 *   MODERN_LINE     only the 0.1.7+ line ships it
 */
const EVERY_CORRIDOR = { 'chunk-stream': 'required', 'attempt-stream': 'required' }
const LEGACY_LINE = { 'chunk-stream': 'required', 'attempt-stream': 'legacy-tolerated' }
const MODERN_LINE = { 'chunk-stream': 'legacy-tolerated', 'attempt-stream': 'required' }

/**
 * The contract table. Every row is one surface the plugin consumes; `check`
 * returns `{ ok, detail }` where `detail` is the "found:" line on success and
 * the reason on failure. `tiers` is the per-corridor tier — this is the whole
 * data model, so reviewing a new Host line means reading this table top to
 * bottom.
 */
const ROWS = [
  ...TRACKED_SESSION_EVENTS.map(event => ({
    id: `session:${event}`,
    tiers: EVERY_CORRIDOR,
    expect: `KNOWN_SESSION_EVENT_TYPES has '${event}'`,
    check: snap => eventKnown(snap, event),
  })),
  {
    id: 'session:assistant/chunk',
    tiers: LEGACY_LINE,
    expect: "KNOWN_SESSION_EVENT_TYPES has 'assistant/chunk' (streamed delta carrier on the rc.*/alpha.* lines)",
    check: snap => eventKnown(snap, 'assistant/chunk'),
  },
  {
    id: 'agent:agent/status',
    tiers: EVERY_CORRIDOR,
    expect: "@deepseek-ai/dsh-agent declares the cordis event 'agent/status' (idle/running transitions)",
    check: snap => declared(snap, 'agent', /'agent\/status'/, "cordis event 'agent/status'"),
  },
  {
    id: 'agent:agent/assistant-stream',
    tiers: MODERN_LINE,
    expect: "@deepseek-ai/dsh-agent declares the cordis event 'agent/assistant-stream' (live delta carrier on the 0.1.7 line)",
    check: snap => declared(snap, 'agent', /'agent\/assistant-stream'/, "cordis event 'agent/assistant-stream'"),
  },
  {
    id: 'session:tool/result.message',
    tiers: EVERY_CORRIDOR,
    expect: "session event 'tool/result' payload declares `message: ToolResultMessage`",
    check: snap => sessionPayload(snap, 'tool/result', /message\s*:\s*ToolResultMessage\b/, 'message: ToolResultMessage'),
  },
  {
    id: 'session:tool/result.error',
    tiers: EVERY_CORRIDOR,
    expect: "session event 'tool/result' payload declares the optional `error` identity",
    check: snap => sessionPayload(snap, 'tool/result', /\berror\s*\?/, 'error?'),
  },
  {
    id: 'llm:ToolResultMessage.source.callId',
    tiers: EVERY_CORRIDOR,
    expect: 'dsh-llm ToolResultMessage.source resolves to a source type declaring `callId`',
    check: snap => sourceCallId(snap),
  },
  {
    id: 'llm:ToolResultMessage.isError',
    tiers: MODERN_LINE,
    expect: 'dsh-llm ToolResultMessage declares `isError` (the failure flag beside `error` on the 0.1.7 line)',
    check: snap => messageIsError(snap),
  },
  {
    id: 'llm:tool-result call correlation',
    tiers: EVERY_CORRIDOR,
    expect: 'dsh-llm ToolResultMessage exposes `toolCallId`, or `content: [ToolResultBlock]` where the block declares `toolCallId`',
    check: snap => correlationId(snap),
  },
  {
    id: 'llm:streamed text delta chunk',
    tiers: EVERY_CORRIDOR,
    expect: "dsh-llm StreamChunk has `text-delta` and `reasoning-delta` members carrying `text`",
    check: snap => streamDeltas(snap),
  },
  {
    id: 'session:Session.events',
    tiers: LEGACY_LINE,
    expect: 'dsh-session Session exposes the `events` getter (durable reader on the rc.*/alpha.* lines)',
    check: snap => declared(snap, 'session', /get\s+events\s*\(\s*\)/, 'Session.events getter'),
  },
  {
    id: 'session:Session.snapshotEvents()',
    tiers: MODERN_LINE,
    expect: 'dsh-session Session declares `snapshotEvents()` (the 0.1.7 replacement for the `events` getter)',
    check: snap => declared(snap, 'session', /\bsnapshotEvents\s*\(/, 'Session.snapshotEvents()'),
  },
  ...['attemptId', 'revision', 'outcome'].map(field => ({
    id: `agent:AssistantStreamFrame.${field}`,
    tiers: MODERN_LINE,
    expect: `dsh-agent AssistantStreamFrame declares \`${field}\``,
    check: snap => frameField(snap, field),
  })),
]

// ---------------------------------------------------------------------------
// Tree / package discovery
// ---------------------------------------------------------------------------

function usage() {
  console.log('usage: node scripts/verify-host-vocabulary.mjs [--tree <dir>]')
}

function parseArgs(argv) {
  let tree = PACKAGE_ROOT
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') { usage(); process.exit(0) }
    if (arg === '--tree') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail('--tree needs a directory argument')
      tree = value
      i += 1
      continue
    }
    if (arg.startsWith('--tree=')) { tree = arg.slice('--tree='.length); continue }
    if (arg.startsWith('-')) fail(`unknown option ${arg}`)
    tree = arg
  }
  const absolute = resolvePath(tree)
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) fail(`--tree ${absolute} is not a directory`)
  return absolute
}

function fail(message) {
  console.error(`verify-host-vocabulary: ${message}`)
  process.exit(1)
}

/**
 * Package directory of `name` resolved from `fromDir` (walking up the real
 * path until a package.json with a matching name is found, so pnpm symlinks
 * into a store still land on the package root).
 */
function resolvePackageRoot(name, fromDir) {
  const req = createRequire(join(fromDir, 'package.json'))
  let entry
  try {
    entry = req.resolve(name)
  } catch {
    return null
  }
  let dir = dirname(entry)
  for (;;) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === name) return dir
      } catch {
        // Unreadable manifest: keep walking up.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Every `.d.ts` under `root` (bounded depth, node_modules and dot-dirs skipped). */
function declarationFiles(root) {
  const files = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.endsWith('.d.ts')) {
        files.push({ rel: relative(root, full).split('\\').join('/'), text: readFileSync(full, 'utf8') })
      }
    }
  }
  walk(root, 0)
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

function loadPackage(name, tree) {
  const root = resolvePackageRoot(name, tree)
  if (root === null) return null
  let version = 'unknown'
  try {
    version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? 'unknown'
  } catch {
    // Version is informational only.
  }
  const files = declarationFiles(root)
  return { name, root, version, files }
}

/** The generated catalog module, wherever this Host line keeps it. */
function findCatalogModule(root, depth = 0) {
  if (depth > 4) return null
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = findCatalogModule(full, depth + 1)
      if (nested !== null) return nested
    } else if (entry.name === 'known-event-types.js') {
      return full
    }
  }
  return null
}

async function loadSessionEventTypes(sessionPkg) {
  const catalog = findCatalogModule(sessionPkg.root)
  if (catalog !== null) {
    const module = await import(pathToFileURL(catalog).href)
    if (module.KNOWN_SESSION_EVENT_TYPES instanceof Set) {
      return { events: module.KNOWN_SESSION_EVENT_TYPES, source: relative(sessionPkg.root, catalog).split('\\').join('/') }
    }
  }
  // Fallback: some lines re-export the catalog from the package entry.
  const req = createRequire(join(sessionPkg.root, 'package.json'))
  try {
    const module = await import(pathToFileURL(req.resolve(HOST_PACKAGES.session)).href)
    if (module.KNOWN_SESSION_EVENT_TYPES instanceof Set) {
      return { events: module.KNOWN_SESSION_EVENT_TYPES, source: '<package entry>' }
    }
  } catch {
    // Fall through to the unresolved result below.
  }
  return null
}

function classifyCorridor(events) {
  if (events.has('assistant/chunk')) return 'chunk-stream'
  if (events.has('assistant/attempt')) return 'attempt-stream'
  return 'unknown'
}

async function loadSnapshot(tree) {
  const packages = {}
  for (const [key, name] of Object.entries(HOST_PACKAGES)) packages[key] = loadPackage(name, tree)
  const session = packages.session
  const catalog = session === null ? null : await loadSessionEventTypes(session)
  const events = catalog?.events ?? null
  return {
    tree,
    packages,
    events,
    catalogSource: catalog?.source ?? null,
    corridor: events === null ? 'unknown' : classifyCorridor(events),
  }
}

// ---------------------------------------------------------------------------
// Declaration parsing (comment-stripped, brace-balanced)
// ---------------------------------------------------------------------------

/** Drop comments while keeping string literals verbatim, so braces in prose cannot unbalance a scan. */
function stripComments(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === '"' || char === "'" || char === '`') {
      out += char
      i += 1
      while (i < source.length) {
        if (source[i] === '\\') { out += source[i] + (source[i + 1] ?? ''); i += 2; continue }
        out += source[i]
        const done = source[i] === char
        i += 1
        if (done) break
      }
      continue
    }
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      out += ' '
      continue
    }
    if (char === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i + 2)
      i = end === -1 ? source.length : end
      continue
    }
    out += char
    i += 1
  }
  return out
}

/** Body of the first brace-balanced block at or after `from`. */
function blockBody(text, from) {
  const open = text.indexOf('{', from)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return null
}

/** Declaration text of one `export interface Name` / `export type Name = …` in `text`. */
function typeBody(text, name) {
  const iface = new RegExp(`(?:^|[\\s;])export\\s+interface\\s+${name}\\b[^{]*`).exec(text)
  if (iface !== null) {
    const body = blockBody(text, iface.index + iface[0].length)
    return body === null ? null : { text: body, kind: 'interface' }
  }
  const alias = new RegExp(`(?:^|[\\s;])export\\s+type\\s+${name}\\b[^=]*=`).exec(text)
  if (alias === null) return null
  // A union alias spans several blocks; read to the first `;` outside any block.
  let depth = 0
  for (let i = alias.index + alias[0].length; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') depth -= 1
    else if (text[i] === ';' && depth === 0) return { text: text.slice(alias.index + alias[0].length, i), kind: 'type' }
  }
  return null
}

/** Body of a quoted member (`'tool/result': { … }`) inside a member map. */
function memberBody(text, member) {
  const pattern = new RegExp(`(?:^|[\\s;{,])'${member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:\\s*`)
  const match = pattern.exec(text)
  if (match === null) return null
  return blockBody(text, match.index + match[0].length)
}

function findDeclaringFile(pkg, pattern) {
  if (pkg === null) return null
  return pkg.files.find(file => pattern.test(packageText(pkg, file))) ?? null
}

/**
 * Comment-stripped declaration text of one file, or of the whole package when
 * `file` is omitted. Members are frequently declared in a sibling file (e.g.
 * `ToolResultBlock` lives in `types.d.ts` while `ToolResultMessage` lives in
 * `message.d.ts`), so cross-type lookups must span the package.
 */
function packageText(pkg, file) {
  if (file !== undefined) {
    file.clean ??= stripComments(file.text)
    return file.clean
  }
  pkg.clean ??= pkg.files.map(entry => packageText(pkg, entry)).join('\n')
  return pkg.clean
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function eventKnown(snap, event) {
  if (snap.events === null) {
    return { ok: false, detail: `no readable KNOWN_SESSION_EVENT_TYPES under ${describe(snap, 'session')}` }
  }
  return snap.events.has(event)
    ? { ok: true, detail: `listed in ${snap.catalogSource} (${snap.events.size} known types)` }
    : { ok: false, detail: `absent from ${snap.catalogSource} (${snap.events.size} known types)` }
}

function declared(snap, packageKey, pattern, label) {
  const pkg = snap.packages[packageKey]
  if (pkg === null) return { ok: false, detail: `${HOST_PACKAGES[packageKey]} is not resolvable from this tree` }
  const file = findDeclaringFile(pkg, pattern)
  return file === null
    ? { ok: false, detail: `no declaration in ${pkg.files.length} .d.ts files under ${pkg.root}` }
    : { ok: true, detail: `${label} declared in ${file.rel}` }
}

function sessionPayload(snap, event, pattern, label) {
  const pkg = snap.packages.session
  if (pkg === null) return { ok: false, detail: `${HOST_PACKAGES.session} is not resolvable from this tree` }
  for (const file of pkg.files) {
    const body = memberBody(packageText(pkg, file), event)
    if (body !== null && pattern.test(body)) {
      return { ok: true, detail: `\`${label}\` in the '${event}' payload (${file.rel})` }
    }
  }
  return { ok: false, detail: `no \`${label}\` inside the '${event}' payload declaration` }
}

function sourceCallId(snap) {
  const pkg = snap.packages.llm
  if (pkg === null) return { ok: false, detail: `${HOST_PACKAGES.llm} is not resolvable from this tree` }
  const file = findDeclaringFile(pkg, /export\s+interface\s+ToolResultMessage\b/)
  if (file === null) return { ok: false, detail: 'no `interface ToolResultMessage` declaration in dsh-llm' }
  const text = packageText(pkg)
  const message = typeBody(text, 'ToolResultMessage')
  if (message === null) return { ok: false, detail: `ToolResultMessage body not readable (${file.rel})` }
  const source = /source\s*:\s*([A-Za-z_$][\w$]*)/.exec(message.text)
  if (source === null) return { ok: false, detail: `ToolResultMessage declares no \`source\` (${file.rel})` }
  const sourceType = typeBody(text, source[1])
  if (sourceType === null) return { ok: false, detail: `ToolResultMessage.source type ${source[1]} not declared in dsh-llm` }
  return /\bcallId\b/.test(sourceType.text)
    ? { ok: true, detail: `${source[1]}.callId (${file.rel})` }
    : { ok: false, detail: `${source[1]} declares no \`callId\` (${file.rel})` }
}

function messageIsError(snap) {
  const pkg = snap.packages.llm
  if (pkg === null) return { ok: false, detail: `${HOST_PACKAGES.llm} is not resolvable from this tree` }
  const file = findDeclaringFile(pkg, /export\s+interface\s+ToolResultMessage\b/)
  if (file === null) return { ok: false, detail: 'no `interface ToolResultMessage` declaration in dsh-llm' }
  const message = typeBody(packageText(pkg), 'ToolResultMessage')
  if (message === null) return { ok: false, detail: `ToolResultMessage body not readable (${file.rel})` }
  return /\bisError\s*\??\s*:/.test(message.text)
    ? { ok: true, detail: `ToolResultMessage.isError (${file.rel})` }
    : { ok: false, detail: `ToolResultMessage declares no \`isError\` (${file.rel})` }
}

function correlationId(snap) {
  const pkg = snap.packages.llm
  if (pkg === null) return { ok: false, detail: `${HOST_PACKAGES.llm} is not resolvable from this tree` }
  const file = findDeclaringFile(pkg, /export\s+interface\s+ToolResultMessage\b/)
  if (file === null) return { ok: false, detail: 'no `interface ToolResultMessage` declaration in dsh-llm' }
  const text = packageText(pkg)
  const message = typeBody(text, 'ToolResultMessage')
  if (message === null) return { ok: false, detail: `ToolResultMessage body not readable (${file.rel})` }
  if (/\btoolCallId\b/.test(message.text)) {
    return { ok: true, detail: `ToolResultMessage.toolCallId (${file.rel})` }
  }
  const content = /content\s*:\s*\[?\s*([A-Za-z_$][\w$]*)/.exec(message.text)
  if (content !== null) {
    const block = typeBody(text, content[1])
    if (block !== null && /\btoolCallId\b/.test(block.text)) {
      return { ok: true, detail: `${content[1]}.toolCallId via message.content (${file.rel})` }
    }
  }
  return {
    ok: false,
    detail: `ToolResultMessage carries neither \`toolCallId\` nor a content block declaring it (${file.rel})`,
  }
}

function streamDeltas(snap) {
  const pkg = snap.packages.llm ?? snap.packages.session
  if (pkg === null) return { ok: false, detail: 'neither dsh-llm nor dsh-session is resolvable from this tree' }
  const file = findDeclaringFile(pkg, /export\s+type\s+StreamChunk\b/)
  if (file === null) return { ok: false, detail: `no \`export type StreamChunk\` declaration under ${pkg.root}` }
  const chunk = typeBody(packageText(pkg), 'StreamChunk')
  if (chunk === null) return { ok: false, detail: `StreamChunk body not readable (${file.rel})` }
  const missing = []
  for (const delta of ['text-delta', 'reasoning-delta']) {
    const variant = chunk.text.split(/\}\s*\|\s*\{/).find(part => part.includes(`'${delta}'`))
    if (variant === undefined) missing.push(`${delta} variant`)
    else if (!/\btext\s*:/.test(variant)) missing.push(`${delta}.text`)
  }
  return missing.length === 0
    ? { ok: true, detail: `text-delta + reasoning-delta carry \`text\` (${file.rel})` }
    : { ok: false, detail: `StreamChunk is missing ${missing.join(', ')} (${file.rel})` }
}

function frameField(snap, field) {
  const pkg = snap.packages.agent
  if (pkg === null) return { ok: false, detail: `${HOST_PACKAGES.agent} is not resolvable from this tree` }
  const file = findDeclaringFile(pkg, /export\s+type\s+AssistantStreamFrame\b/)
  if (file === null) return { ok: false, detail: `no \`export type AssistantStreamFrame\` declaration under ${pkg.root}` }
  const frame = typeBody(packageText(pkg), 'AssistantStreamFrame')
  if (frame === null) return { ok: false, detail: `AssistantStreamFrame body not readable (${file.rel})` }
  return new RegExp(`\\b${field}\\s*[?:]`).test(frame.text)
    ? { ok: true, detail: `AssistantStreamFrame.${field} (${file.rel})` }
    : { ok: false, detail: `AssistantStreamFrame declares no \`${field}\` (${file.rel})` }
}

function describe(snap, key) {
  const pkg = snap.packages[key]
  return pkg === null ? `${HOST_PACKAGES[key]} (unresolved)` : pkg.root
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function tierOf(row, corridor) {
  return row.tiers[corridor] ?? 'required'
}

function main(snap) {
  const { corridor } = snap
  console.log(`verify-host-vocabulary: tree ${snap.tree}`)
  for (const [key, name] of Object.entries(HOST_PACKAGES)) {
    const pkg = snap.packages[key]
    console.log(`  host ${name.padEnd(28)} ${pkg === null ? 'UNRESOLVED' : pkg.version}`)
  }
  if (corridor === 'unknown') {
    console.error('verify-host-vocabulary: FAIL — unrecognized Host corridor')
    console.error(`  KNOWN_SESSION_EVENT_TYPES: ${snap.events === null ? `unreadable under ${describe(snap, 'session')}` : `${snap.events.size} types from ${snap.catalogSource}`}`)
    console.error("  expected either 'assistant/chunk' (chunk-stream) or 'assistant/attempt' (attempt-stream)")
    console.error('  next: a new Host line changed how streamed deltas are named — review the ROWS table')
    console.error('        against that Host, then re-run. Check --tree points at the intended tree.')
    process.exit(1)
  }
  console.log(`  corridor ${corridor}`)
  console.log(`  catalog   ${snap.catalogSource ?? 'unreadable'} (${snap.events.size} known session event types)`)
  console.log('')

  const missing = []
  for (const row of ROWS) {
    const tier = tierOf(row, corridor)
    const result = row.check(snap)
    const required = tier === 'required'
    if (result.ok) {
      console.log(`  ok       [${tier}]  ${row.id}`)
      console.log(`             ${result.detail}`)
    } else if (required) {
      missing.push(row)
      console.log(`  MISSING  [${tier}]  ${row.id}`)
      console.log(`             ${result.detail}`)
    } else {
      console.log(`  absent   [${tier}]  ${row.id}`)
      console.log(`             ${result.detail}`)
    }
  }
  console.log('')

  if (missing.length > 0) {
    console.error(`verify-host-vocabulary: FAIL (${missing.length} missing, ${ROWS.length} checked) — tree ${snap.tree}, corridor ${corridor}`)
    console.error('')
    console.error('  missing (required on this corridor):')
    for (const row of missing) {
      const result = row.check(snap)
      console.error(`    - ${row.id}  [tier: ${tierOf(row, corridor)} on ${corridor}]`)
      console.error(`        expected: ${row.expect}`)
      console.error(`        found:    ${result.detail}`)
    }
    console.error('')
    console.error('  next: either this Host line renamed/removed these surfaces (update the plugin and')
    console.error('        this table together), or --tree points at the wrong tree.')
    process.exit(1)
  }

  const toleratedAbsent = ROWS.filter(row => tierOf(row, corridor) !== 'required' && !row.check(snap).ok).length
  console.log(
    `verify-host-vocabulary: OK (${ROWS.length} checks, corridor ${corridor}, `
    + `${toleratedAbsent} legacy-tolerated surface${toleratedAbsent === 1 ? '' : 's'} absent on this line)`,
  )
  process.exit(0)
}

main(await loadSnapshot(parseArgs(process.argv.slice(2))))
