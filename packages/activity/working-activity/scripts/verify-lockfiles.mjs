#!/usr/bin/env node
/**
 * Verification: the two maintained lockfiles agree with package.json and
 * with each other on the direct-dependency declaration — the drift gate for
 * maintaining package-lock.json (npm, the publish path) and pnpm-lock.yaml
 * (development) side by side.
 *
 * Compared per dependency field (dependencies / optionalDependencies /
 * devDependencies): the exact name→range map in package.json, in
 * package-lock.json's packages[""] block, and in pnpm-lock.yaml's
 * importers["."] specifiers. peerDependencies are compared between
 * package.json and package-lock.json only (pnpm records the local rc baseline
 * through devDependency mirrors, while broader compatibility ranges remain
 * package metadata).
 *
 * The package keeps broad Host peer ranges while this root development graph
 * stays on the rc baseline. Assert that neither npm nor pnpm silently mixes
 * its agent loop with Host services from a different DSH release; alpha.2
 * runs in the isolated sibling compatibility fixture.
 *
 * Exits non-zero on any mismatch.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const RUNTIME_FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies']
const ALL_FIELDS = [...RUNTIME_FIELDS, 'peerDependencies']

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const npmLock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
const pnpmLock = await readFile(new URL('pnpm-lock.yaml', root), 'utf8')

const npmRoot = npmLock.packages?.[''] ?? {}

/**
 * Parse the importers["."] block of a pnpm-lock v9 file: field headers at
 * 4-space indent, entries at 6-space, `specifier:` at 8-space. Only that
 * block is read — the rest of the YAML is irrelevant here.
 */
function parsePnpmImporters(text) {
  const fields = {}
  const resolved = {}
  let inImporter = false
  let field = null
  let name = null
  // Tolerate CRLF checkouts (Windows autocrlf): the $-anchored patterns
  // below must not be defeated by a trailing \r.
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (/^  \.:/.test(line)) { inImporter = true; continue }
    if (inImporter && (/^\S/.test(line) || /^  \S/.test(line))) break // next top-level key or importer
    if (!inImporter) continue
    const fieldMatch = line.match(/^    (dependencies|devDependencies|optionalDependencies):$/)
    if (fieldMatch) {
      field = fieldMatch[1]
      fields[field] = {}
      resolved[field] = {}
      name = null
      continue
    }
    const entryMatch = line.match(/^      ('[^']+'|\S+):$/)
    if (field !== null && entryMatch) {
      name = entryMatch[1].replace(/^'|'$/g, '')
      continue
    }
    const specMatch = line.match(/^        specifier: (.+)$/)
    if (field !== null && name !== null && specMatch) {
      fields[field][name] = specMatch[1].trim()
      continue
    }
    const versionMatch = line.match(/^        version: (.+)$/)
    if (field !== null && name !== null && versionMatch) {
      resolved[field][name] = versionMatch[1].trim()
      name = null
    }
  }
  return { fields, resolved }
}

const { fields: pnpmFields, resolved: pnpmResolved } = parsePnpmImporters(pnpmLock)

const failures = []
for (const field of ALL_FIELDS) {
  const declared = manifest[field] ?? {}
  const npmRecorded = npmRoot[field] ?? {}
  assert.deepEqual(
    npmRecorded, declared,
    `package-lock.json packages[""].${field} drifted from package.json`,
  )
  if (!RUNTIME_FIELDS.includes(field)) continue
  const pnpmRecorded = pnpmFields[field] ?? {}
  assert.deepEqual(
    pnpmRecorded, declared,
    `pnpm-lock.yaml importers["."].${field} specifiers drifted from package.json`,
  )
}

const npmPackages = npmLock.packages ?? {}
const hostBaseline = npmPackages['node_modules/@deepseek-ai/dsh-agent-loop']?.version
/** Host peers whose RC2 release line skipped 0.2.1-rc.2; value is the allowed mirror. */
const HOST_VERSION_SKEW = new Map([
  ['@deepseek-ai/dsh-invariants', '0.2.0-rc.2'],
])
assert.ok(hostBaseline, 'package-lock.json has no resolved dsh-agent-loop Host baseline')
const pnpmVersion = value => value?.replace(/^['"]|['"]$/g, '').split('(')[0]
const pnpmHostBaseline = pnpmVersion(
  pnpmResolved.devDependencies?.['@deepseek-ai/dsh-agent-loop'],
)
assert.equal(
  pnpmHostBaseline,
  hostBaseline,
  `npm/pnpm Host baseline drift: npm ${hostBaseline} vs pnpm ${pnpmHostBaseline}`,
)
for (const name of [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-system-prompt',
]) {
  const allowed = HOST_VERSION_SKEW.get(name) ?? hostBaseline
  assert.equal(
    npmPackages[`node_modules/${name}`]?.version,
    allowed,
    `package-lock.json mixes Host baselines: ${name} must match dsh-agent-loop ${hostBaseline}`
    + (HOST_VERSION_SKEW.has(name) ? ` (or its documented RC2 skew ${allowed})` : ''),
  )
  assert.equal(
    pnpmVersion(pnpmResolved.devDependencies?.[name]),
    allowed,
    `pnpm-lock.yaml mixes Host baselines: ${name} must match dsh-agent-loop ${hostBaseline}`
    + (HOST_VERSION_SKEW.has(name) ? ` (or its documented RC2 skew ${allowed})` : ''),
  )
}

console.log(`verify-lockfiles: OK (npm + pnpm declarations agree; Host baseline ${hostBaseline})`)
