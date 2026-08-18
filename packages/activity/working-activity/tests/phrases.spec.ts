/**
 * Copy-pool and formatter tests for the working-activity phrases module.
 * @module @deepseek-ai/dsh-working-activity/tests/phrases
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  actionFor, fmtDuration, isGitTool, isNight, pickPhrase, thinkingPhrase,
  waitingPhrase,
} from '../src/phrases.ts'
import { setLangOverride } from '../src/lang.ts'

// Deterministic language: the ambient machine may have DSH_TUI_LANG or a
// persisted ~/.dsh-tui/lang.json (the user's own prefs), which would flip
// the pools mid-suite. Pin zh for the legacy assertions and reset after.
beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

describe('pickPhrase', () => {
  it('returns entries from the pool and avoids the previous one', () => {
    const pool = ['a', 'b', 'c'] as const
    for (let i = 0; i < 50; i++) {
      expect(pool).toContain(pickPhrase(pool, 'a'))
    }
  })

  it('throws on an empty pool', () => {
    expect(() => pickPhrase([])).toThrow(/non-empty/)
  })
})

describe('thinkingPhrase', () => {
  it('returns a phrase for fresh thinking', () => {
    const phrase = thinkingPhrase(0)
    expect(phrase.length).toBeGreaterThan(0)
  })

  it('mixes night copy into the base pool at night', () => {
    const phrases = new Set<string>()
    for (let i = 0; i < 200; i++) {
      phrases.add(thinkingPhrase(0, undefined, true))
    }
    expect(phrases.size).toBeGreaterThan(10)
  })

  it('switches to the long-thinking tiers as elapsed grows', () => {
    const thirty = thinkingPhrase(31_000)
    expect(thirty.length).toBeGreaterThan(0)
    const minute = thinkingPhrase(61_000)
    expect(minute.length).toBeGreaterThan(0)
    const five = thinkingPhrase(301_000)
    expect(five.length).toBeGreaterThan(0)
  })
})

describe('actionFor', () => {
  it('maps known tool names to playful verbs', () => {
    expect(actionFor('bash')).toMatch(/跑|命令|敲|终端|执行|bash/)
    expect(actionFor('read_file')).toMatch(/读|看|翻|瞄|康/)
  })

  it('falls back for unknown tools', () => {
    const verb = actionFor('mystery_tool_xyz')
    expect(verb.length).toBeGreaterThan(0)
  })

  it('prefers exact-name custom pools', () => {
    expect(actionFor('my_deploy', { my_deploy: ['部署一下'] })).toBe('部署一下')
  })
})

describe('isGitTool', () => {
  it('matches git tool names directly', () => {
    expect(isGitTool('git_commit')).toBe(true)
    expect(isGitTool('gh')).toBe(true)
  })

  it('detects git inside shell commands', () => {
    expect(isGitTool('bash', { command: 'git status' })).toBe(true)
    expect(isGitTool('bash', { command: 'npm test' })).toBe(false)
    expect(isGitTool('bash', {})).toBe(false)
  })
})

describe('fmtDuration', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(fmtDuration(0)).toBe('0s')
    expect(fmtDuration(999)).toBe('0s')
    expect(fmtDuration(1000)).toBe('1s')
    expect(fmtDuration(83_000)).toBe('1m23s')
    expect(fmtDuration(3_660_000)).toBe('1h1m')
  })
})

describe('isNight', () => {
  it('detects the 00:00–06:00 window', () => {
    expect(isNight(0)).toBe(true)
    expect(isNight(3)).toBe(true)
    expect(isNight(5)).toBe(true)
    expect(isNight(6)).toBe(false)
    expect(isNight(12)).toBe(false)
    expect(isNight(23)).toBe(false)
  })
})

describe('English pools', () => {
  it('draws playful English thinking phrases without Han', () => {
    setLangOverride('en')
    const phrases = new Set<string>()
    for (let i = 0; i < 80; i++) {
      const phrase = thinkingPhrase(0)
      expect(phrase).not.toMatch(/\p{Script=Han}/u)
      phrases.add(phrase)
    }
    expect(phrases.size).toBeGreaterThan(5)
  })

  it('draws English waiting phrases without Han', () => {
    setLangOverride('en')
    const phrases = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const phrase = waitingPhrase()
      expect(phrase).not.toMatch(/\p{Script=Han}/u)
      phrases.add(phrase)
    }
    expect(phrases.size).toBeGreaterThan(5)
  })

  it('maps tools to English verbs without Han', () => {
    setLangOverride('en')
    expect(actionFor('bash')).not.toMatch(/\p{Script=Han}/u)
    expect(actionFor('read_file')).not.toMatch(/\p{Script=Han}/u)
    expect(actionFor('web_search')).not.toMatch(/\p{Script=Han}/u)
    expect(actionFor('mystery_tool_xyz')).not.toMatch(/\p{Script=Han}/u)
  })

  it('keeps user custom pools verbatim in English mode', () => {
    setLangOverride('en')
    expect(actionFor('my_deploy', { my_deploy: ['部署一下'] })).toBe('部署一下')
  })

  it('switches back to zh pools when the language flips', () => {
    setLangOverride('en')
    const enVerb = actionFor('read_file')
    expect(enVerb).not.toMatch(/\p{Script=Han}/u)
    setLangOverride('zh')
    expect(actionFor('read_file')).toMatch(/读|看|翻|瞄|康/)
  })
})
