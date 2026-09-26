/**
 * Language-file probe cache tests (issue #14, the `statSync` half).
 *
 * The plugin resolves its copy language on every translation, and a render
 * translates several keys. Probing the prefs file each time meant a syscall per
 * key — and, on a host that never wrote the file, a FAILED syscall per key.
 * These cases count the filesystem calls so the cache cannot regress into a
 * comment that claims caching.
 * @module @deepseek-ai/dsh-working-activity/tests/lang
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Filesystem stand-in the mocked `node:fs` reads and counts. */
const fs = vi.hoisted(() => ({
  present: true,
  mtimeMs: 111,
  text: '{"lang":"en"}',
  statCalls: 0,
  readCalls: 0,
}))

vi.mock('node:fs', () => ({
  statSync: () => {
    fs.statCalls += 1
    if (!fs.present) throw new Error('ENOENT')
    return { mtimeMs: fs.mtimeMs }
  },
  readFileSync: () => {
    fs.readCalls += 1
    return fs.text
  },
}))

const { invalidateLangCache, readLangFile } = await import('../src/lang.ts')

beforeEach(() => {
  fs.present = true
  fs.mtimeMs = 111
  fs.text = '{"lang":"en"}'
  fs.statCalls = 0
  fs.readCalls = 0
  invalidateLangCache()
})

describe('readLangFile probe cache', () => {
  it('probes and parses once, then answers from cache inside the TTL', () => {
    expect(readLangFile(1_000_000)).toBe('en')
    expect(fs.statCalls).toBe(1)
    expect(fs.readCalls).toBe(1)

    // A render translates several keys back to back.
    expect(readLangFile(1_000_100)).toBe('en')
    expect(readLangFile(1_000_400)).toBe('en')
    expect(fs.statCalls).toBe(1)
    expect(fs.readCalls).toBe(1)
  })

  it('re-probes after the TTL but does not re-read an unchanged file', () => {
    expect(readLangFile(1_000_000)).toBe('en')
    expect(readLangFile(1_001_001)).toBe('en')
    expect(fs.statCalls).toBe(2)
    expect(fs.readCalls).toBe(1)
  })

  it('picks up a rewritten file once its mtime changes', () => {
    expect(readLangFile(1_000_000)).toBe('en')
    fs.text = '{"lang":"zh"}'
    fs.mtimeMs = 222
    expect(readLangFile(1_001_001)).toBe('zh')
    expect(fs.readCalls).toBe(2)
  })

  it('caches a missing file instead of failing a probe per key', () => {
    fs.present = false
    expect(readLangFile(1_000_000)).toBeUndefined()
    expect(fs.statCalls).toBe(1)
    expect(readLangFile(1_000_200)).toBeUndefined()
    expect(readLangFile(1_000_900)).toBeUndefined()
    expect(fs.statCalls).toBe(1)

    // It also notices the file appearing later.
    fs.present = true
    expect(readLangFile(1_001_001)).toBe('en')
    expect(fs.statCalls).toBe(2)
  })

  it('ignores a file that holds no valid language', () => {
    fs.text = '{"lang":"fr"}'
    expect(readLangFile(1_000_000)).toBeUndefined()
    fs.text = 'not json'
    fs.mtimeMs = 333
    expect(readLangFile(1_001_001)).toBeUndefined()
  })

  it('probes immediately again after an explicit invalidation', () => {
    expect(readLangFile(1_000_000)).toBe('en')
    expect(fs.statCalls).toBe(1)
    invalidateLangCache()
    expect(readLangFile(1_000_001)).toBe('en')
    expect(fs.statCalls).toBe(2)
  })
})
