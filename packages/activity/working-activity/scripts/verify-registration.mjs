#!/usr/bin/env node
/**
 * Verification: registerActivityEventType registers `activity/status` into
 * EVERY reachable dsh-session copy — the plugin/profile tree (import.meta
 * anchor) and the CLI tree (process.argv[1] anchor) can hold different
 * physical copies during upgrade windows, and strict read-path validators
 * only consult their own copy.
 *
 * The CLI-tree copy is exercised by pointing argv[1] at the harness repo's
 * CLI bin before calling — the exact anchor the production code uses.
 * Exits non-zero on any assertion failure.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const ownReq = createRequire(import.meta.url)
const ownKnown = ownReq('@deepseek-ai/dsh-session').KNOWN_SESSION_EVENT_TYPES

// The CLI tree anchor: the harness checkout (or global install) this host
// boots from. Overridable for other machines; defaults to the known local
// source build, falling back to a skip when absent.
const cliBin = process.env.DSH_CLI_BIN ?? 'D:/code/projects/deepseek-harness/apps/cli/lib/bin.js'
let cliKnown
try {
  cliKnown = createRequire(cliBin)('@deepseek-ai/dsh-session').KNOWN_SESSION_EVENT_TYPES
} catch {
  cliKnown = undefined
}

ownKnown.delete('activity/status')
cliKnown?.delete('activity/status')
assert.equal(ownKnown.has('activity/status'), false, 'precondition: own copy clean')
if (cliKnown) assert.equal(cliKnown.has('activity/status'), false, 'precondition: CLI copy clean')

const { registerActivityEventType } = await import('../lib/types/registration.js')
process.argv[1] = cliBin // the anchor the CLI-tree registration resolves from
registerActivityEventType()

assert.equal(ownKnown.has('activity/status'), true, 'own-tree copy registered')
if (cliKnown) {
  assert.equal(cliKnown.has('activity/status'), true, 'CLI-tree copy registered (the validator side)')
} else {
  console.log('verify-registration: SKIP CLI-tree assertion (no dsh CLI checkout found)')
}

// Idempotent: a second call must not throw or corrupt either set.
registerActivityEventType()
assert.equal(ownKnown.has('activity/status'), true, 'second call keeps the registration')

console.log('verify-registration: OK')
