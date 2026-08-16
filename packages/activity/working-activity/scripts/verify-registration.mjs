#!/usr/bin/env node
/**
 * Verification: registerActivityEventType registers `activity/status` into
 * EVERY reachable dsh-session copy — including the VALIDATOR copy, the
 * physical duplicate that dsh-session-persistence resolves under nested /
 * split-tree layouts and that neither top-level anchor can reach
 * (working-activity#4, gap one).
 *
 * Fixture: a fabricated CLI tree whose @deepseek-ai/dsh-session-persistence
 * carries its own nested, physically distinct dsh-session copy. The old
 * two-anchor top-level-only behavior is replayed as a negative control —
 * it must leave the validator copy untouched — before the real call must
 * cover all three Sets (own tree, fixture top level, fixture nested).
 *
 * The CLI-tree copy is exercised by pointing argv[1] at the fixture bin —
 * the exact anchor the production code uses. Exits non-zero on any
 * assertion failure.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const ownReq = createRequire(import.meta.url)
const ownKnown = ownReq('@deepseek-ai/dsh-session').KNOWN_SESSION_EVENT_TYPES

// --- Split-tree fixture -----------------------------------------------------
// <tmp>/cli/bin.js                                  argv[1] anchor
// <tmp>/node_modules/@deepseek-ai/dsh-session       copy A (CLI top level)
// <tmp>/node_modules/@deepseek-ai/dsh-session-persistence
//   └─ node_modules/@deepseek-ai/dsh-session        copy B (validator's copy)
const fixture = mkdtempSync(join(tmpdir(), 'wa-split-tree-'))
try {
  const sessionSrc = dirname(realpathSync(ownReq.resolve('@deepseek-ai/dsh-session/package.json')))
  const copyA = join(fixture, 'node_modules', '@deepseek-ai', 'dsh-session')
  const persistenceRoot = join(fixture, 'node_modules', '@deepseek-ai', 'dsh-session-persistence')
  const copyB = join(persistenceRoot, 'node_modules', '@deepseek-ai', 'dsh-session')

  mkdirSync(join(fixture, 'cli'), { recursive: true })
  const cliBin = join(fixture, 'cli', 'bin.js')
  writeFileSync(cliBin, '// fixture CLI entry\n')
  cpSync(sessionSrc, copyA, { recursive: true })
  cpSync(sessionSrc, copyB, { recursive: true })
  // The copies' own imports (cordis & co.) resolve by walking up to the
  // fixture's node_modules — mirror the peer set from the real install so
  // the fixture tree is self-contained. Symlink realpaths: their own
  // transitive deps keep resolving inside the pnpm store.
  const fixtureScope = join(fixture, 'node_modules', '@deepseek-ai')
  const sessionReq = createRequire(join(sessionSrc, 'package.json'))
  for (const dep of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/dsh-invariants']) {
    try {
      symlinkSync(dirname(realpathSync(sessionReq.resolve(`${dep}/package.json`))), join(fixtureScope, dep.split('/')[1]), 'dir')
    } catch {
      // Not installed in this dev tree — the copies only fail if they actually import it.
    }
  }
  writeFileSync(join(persistenceRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-session-persistence', version: '0.0.0-fixture',
    type: 'module', main: 'index.js', exports: { '.': './index.js' },
  }))
  writeFileSync(join(persistenceRoot, 'index.js'), '// fixture persistence entry\n')

  const knownA = createRequire(cliBin)('@deepseek-ai/dsh-session').KNOWN_SESSION_EVENT_TYPES
  const knownB = createRequire(join(persistenceRoot, 'index.js'))('@deepseek-ai/dsh-session').KNOWN_SESSION_EVENT_TYPES
  assert.notEqual(realpathSync(ownReq.resolve('@deepseek-ai/dsh-session')), realpathSync(join(copyB, 'lib', 'index.js')),
    'precondition: validator copy is a distinct physical copy')

  // Clean slate in all three Sets.
  for (const known of [ownKnown, knownA, knownB]) known.delete('activity/status')

  // Negative control: the pre-#4 behavior (top-level registration per anchor,
  // no validator walk) leaves the validator's copy unregistered — the exact
  // profile✓ / cli✓ / validator✗ gap from dsh-TUI#163's split-tree fixture.
  knownA.add('activity/status')
  assert.equal(knownA.has('activity/status'), true, 'negative control: CLI top-level copy registered')
  assert.equal(knownB.has('activity/status'), false, 'negative control: validator copy still untouched')

  // The real registration: argv[1] points at the fixture CLI bin.
  const { registerActivityEventType } = await import('../lib/types/registration.js')
  process.argv[1] = cliBin
  registerActivityEventType()

  assert.equal(ownKnown.has('activity/status'), true, 'own-tree copy registered')
  assert.equal(knownA.has('activity/status'), true, 'fixture CLI copy registered')
  assert.equal(knownB.has('activity/status'), true, 'validator copy registered (the #4 walk edge)')

  // Idempotent: a second call must not throw or corrupt any set.
  registerActivityEventType()
  assert.equal(knownB.has('activity/status'), true, 'second call keeps the registration')

  // Optional legacy probe: a real harness checkout's CLI tree, when present.
  const realCliBin = process.env.DSH_CLI_BIN ?? 'D:/code/projects/deepseek-harness/apps/cli/lib/bin.js'
  try {
    const realCliKnown = createRequire(realCliBin)('@deepseek-ai/dsh-session').KNOWN_SESSION_EVENT_TYPES
    realCliKnown.delete('activity/status')
    registerActivityEventType()
    assert.equal(realCliKnown.has('activity/status'), false,
      'fixture argv[1] must not leak into an unrelated CLI tree')
  } catch (error) {
    // Absent checkout (or a foreign-platform default path) — nothing to probe.
    if (error?.code !== 'MODULE_NOT_FOUND' && !(error instanceof TypeError)) throw error
    console.log('verify-registration: SKIP real-CLI-tree probe (no dsh CLI checkout found)')
  }

  console.log('verify-registration: OK (own + CLI + validator copies covered)')
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
