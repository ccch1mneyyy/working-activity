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
 * package.json and package-lock.json only (pnpm records peers through their
 * devDependency mirrors, already asserted by verify-manifest-deps).
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
    if (fieldMatch) { field = fieldMatch[1]; fields[field] = {}; continue }
    const entryMatch = line.match(/^      ('[^']+'|\S+):$/)
    if (field !== null && entryMatch) {
      name = entryMatch[1].replace(/^'|'$/g, '')
      continue
    }
    const specMatch = line.match(/^        specifier: (.+)$/)
    if (field !== null && name !== null && specMatch) {
      fields[field][name] = specMatch[1].trim()
      name = null
    }
  }
  return fields
}

const pnpmFields = parsePnpmImporters(pnpmLock)

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

console.log(`verify-lockfiles: OK (npm + pnpm lockfiles agree with package.json on ${ALL_FIELDS.length} dep fields)`)
