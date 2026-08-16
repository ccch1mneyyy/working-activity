#!/usr/bin/env node
/**
 * Verification: framework packages (@deepseek-ai/*, react) are provided by the
 * dsh host, never materialized into a profile. Two assertions:
 *
 * 1. `dependencies` / `optionalDependencies` must not contain any framework
 *    package — a plain dependency makes pnpm install a real copy into the
 *    profile's node_modules, shadowing the host fallback tree and splitting
 *    module identity (the dsh-TUI#198 failure mode).
 * 2. Every peerDependency must have a devDependency mirror with the identical
 *    range, so local type-check/build resolves the same versions the host
 *    provides at runtime.
 *
 * Exits non-zero on any assertion failure.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const FRAMEWORK = /^@deepseek-ai\/|^react(-dom)?$/

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

for (const field of ['dependencies', 'optionalDependencies']) {
  const offenders = Object.keys(manifest[field] ?? {}).filter(name => FRAMEWORK.test(name))
  assert.deepEqual(
    offenders, [],
    `${field} must not contain framework packages (host-provided): ${offenders.join(', ')} — `
    + 'move them to peerDependencies with a same-range devDependencies mirror',
  )
}

const peers = manifest.peerDependencies ?? {}
const devs = manifest.devDependencies ?? {}
for (const [name, range] of Object.entries(peers)) {
  assert.ok(
    name in devs,
    `peerDependency ${name} has no devDependencies mirror — local build would resolve nothing`,
  )
  assert.equal(
    devs[name], range,
    `peer/dev range mismatch for ${name}: peer ${range} vs dev ${devs[name]}`,
  )
}

console.log(`verify-manifest-deps: OK (${Object.keys(peers).length} peers mirrored, no framework deps)`)
