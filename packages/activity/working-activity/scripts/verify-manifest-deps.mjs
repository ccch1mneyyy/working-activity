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
 *    peers may advertise several Host releases; the local dev mirror must be
 *    a concrete release on the DSH 0.2.1-rc.2 line that satisfies one of the
 *    advertised alternatives. Lockstep Host peers must exactly match the
 *    dsh-agent-loop baseline, with one documented skew: `dsh-invariants` has
 *    no 0.2.1-rc.2 release, so its RC2 mirror is 0.2.0-rc.2.
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

/** Host peers whose RC2 release line skipped 0.2.1-rc.2; value is the allowed mirror. */
const HOST_VERSION_SKEW = new Map([
  ['@deepseek-ai/dsh-invariants', '0.2.0-rc.2'],
])

/** Strip a range operator and return the leading version token. */
function baseVersion(range) {
  return range.trim().replace(/^[~^=]\s*/, '').split(/[\s|]/)[0]
}

/** Whether a concrete dev mirror satisfies at least one advertised alternative. */
function rangeAllows(range, mirror) {
  const wanted = baseVersion(mirror)
  const [wantedMajor, wantedMinor] = wanted.split('.').map(Number)
  if (!Number.isInteger(wantedMajor) || !Number.isInteger(wantedMinor)) return false
  return range.split('||').some((alternative) => {
    const base = baseVersion(alternative)
    if (!/^\d/.test(base)) return false
    const [major, minor] = base.split('.').map(Number)
    // Corridor equality (major.minor) is the real constraint: a dev mirror on
    // the same DSH minor may move patch/prerelease without leaving the line.
    return major === wantedMajor && minor === wantedMinor
  })
}

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
    const allowed = HOST_VERSION_SKEW.get(name) ?? hostBaseline
    assert.equal(
      devs[name], allowed,
      `${name} dev range ${devs[name]} must match ${HOST_BASELINE_ANCHOR} ${hostBaseline}`
      + (HOST_VERSION_SKEW.has(name) ? ` (or its documented RC2 skew ${allowed})` : ''),
    )
  } else {
    assert.ok(
      rangeAllows(range, devs[name]),
      `peer/dev mismatch for ${name}: peer ${range} admits no ${devs[name]} mirror on the same corridor`,
    )
  }
}

console.log(
  `verify-manifest-deps: OK (${Object.keys(peers).length} peers mirrored; Host dev baseline ${hostBaseline})`,
)
