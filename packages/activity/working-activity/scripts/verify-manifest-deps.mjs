#!/usr/bin/env node
/**
 * Verification: framework packages (@deepseek-ai/*, react) are provided by the
 * dsh host, never materialized into a profile. Two assertions:
 *
 * 1. `dependencies` / `optionalDependencies` must not contain any framework
 *    package — a plain dependency makes pnpm install a real copy into the
 *    profile's node_modules, shadowing the host fallback tree and splitting
 *    module identity (the dsh-TUI#198 failure mode).
 * 2. Every peerDependency must have a devDependency mirror. Compatibility
 *    peers may advertise several Host releases, but their local dev mirrors
 *    must stay in lockstep with dsh-agent-loop's rc development baseline;
 *    every other peer keeps an identical mirror range.
 *
 * Exits non-zero on any assertion failure.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const FRAMEWORK = /^@deepseek-ai\/|^react(-dom)?$/
const HOST_LOCKSTEP_PEERS = new Set([
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-system-prompt',
])
const HOST_BASELINE_ANCHOR = '@deepseek-ai/dsh-agent-loop'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

for (const field of ['dependencies', 'optionalDependencies']) {
  const offenders = Object.keys(manifest[field] ?? {}).filter(name => FRAMEWORK.test(name))
  assert.deepEqual(
    offenders, [],
    `${field} must not contain framework packages (host-provided): ${offenders.join(', ')} — `
    + 'move them to peerDependencies with a devDependencies mirror',
  )
}

const peers = manifest.peerDependencies ?? {}
const devs = manifest.devDependencies ?? {}
const hostBaseline = devs[HOST_BASELINE_ANCHOR]
assert.ok(hostBaseline, `devDependencies has no ${HOST_BASELINE_ANCHOR} Host baseline`)
for (const [name, range] of Object.entries(peers)) {
  assert.ok(
    name in devs,
    `peerDependency ${name} has no devDependencies mirror — local build would resolve nothing`,
  )
  if (HOST_LOCKSTEP_PEERS.has(name)) {
    assert.equal(
      devs[name], hostBaseline,
      `${name} dev range ${devs[name]} must match ${HOST_BASELINE_ANCHOR} ${hostBaseline}`,
    )
  } else {
    assert.equal(
      devs[name], range,
      `peer/dev range mismatch for ${name}: peer ${range} vs dev ${devs[name]}`,
    )
  }
}

console.log(
  `verify-manifest-deps: OK (${Object.keys(peers).length} peers mirrored; Host dev baseline ${hostBaseline})`,
)
