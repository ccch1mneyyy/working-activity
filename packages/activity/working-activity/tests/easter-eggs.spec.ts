/**
 * Easter-egg tests: holiday / rare / weekend pickers and the lively
 * selector order, plus custom-phrase merging.
 * @module @deepseek-ai/dsh-working-activity/tests/easter-eggs
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  holidayPhrase, isWeekend, livelyThinkingPhrase, RARE_PHRASES, thinkingPhrase,
  WEEKEND_PHRASES, continuePhrase, compactPhrase, modelQuip,
} from '../src/phrases.ts'
import { setLangOverride } from '../src/lang.ts'

beforeEach(() => setLangOverride('zh'))
afterEach(() => {
  setLangOverride('auto')
  vi.restoreAllMocks()
})

/**
 * Every phrase in `HOLIDAY_PHRASES['01-01']` must match this — including
 * `新的一年，新的 bug` (no contiguous 新年). Keep in sync with the pool.
 */
const NEW_YEAR_PATTERN = /新年|元旦|开工|第一盘|第一行|新的一年/

describe('isWeekend', () => {
  it('flags Saturday and Sunday only', () => {
    expect(isWeekend(new Date('2026-01-03T12:00:00'))).toBe(true) // Sat
    expect(isWeekend(new Date('2026-01-04T12:00:00'))).toBe(true) // Sun
    expect(isWeekend(new Date('2026-01-05T12:00:00'))).toBe(false) // Mon
  })
})

describe('holidayPhrase', () => {
  it('returns copy on fixed holidays and Lunar New Year', () => {
    expect(holidayPhrase(new Date('2026-01-01T12:00:00'))).not.toBeNull()
    expect(holidayPhrase(new Date('2026-02-17T12:00:00'))).not.toBeNull() // 2026 春节
  })

  it('returns null on ordinary days', () => {
    expect(holidayPhrase(new Date('2026-03-15T12:00:00'))).toBeNull()
  })
})

describe('livelyThinkingPhrase', () => {
  it('picks a holiday phrase on a holiday before anything else', () => {
    const now = new Date('2026-01-01T12:00:00')
    const phrase = livelyThinkingPhrase(0, undefined, false, now, { rareEggs: false, weekend: false })
    expect(phrase).toMatch(NEW_YEAR_PATTERN)
  })

  it('skips the holiday egg when the feature is off', () => {
    const now = new Date('2026-01-01T12:00:00')
    const phrase = livelyThinkingPhrase(0, undefined, false, now, {
      rareEggs: false, weekend: false, holidays: false,
    })
    expect(phrase).not.toMatch(NEW_YEAR_PATTERN)
  })

  it('draws a rare egg when Math.random lands in the 1/150 window', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const now = new Date('2026-03-15T12:00:00')
    const phrase = livelyThinkingPhrase(0, undefined, false, now, { weekend: false })
    expect(RARE_PHRASES).toContain(phrase)
  })

  it('never draws rare eggs when the feature is off', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const now = new Date('2026-03-15T12:00:00')
    const phrase = livelyThinkingPhrase(0, undefined, false, now, { rareEggs: false, weekend: false })
    expect(RARE_PHRASES).not.toContain(phrase)
  })

  it('greets on weekends when the feature is on', () => {
    const now = new Date('2026-01-03T12:00:00') // Sat
    const phrase = livelyThinkingPhrase(0, undefined, false, now, { rareEggs: false })
    expect(WEEKEND_PHRASES).toContain(phrase)
  })
})

describe('custom phrases', () => {
  it('merges custom phrases into the base thinking pool', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 800; i++) seen.add(thinkingPhrase(0, undefined, false, ['自定义一条']))
    expect(seen).toContain('自定义一条')
  })
})

describe('special pools', () => {
  it('continue / compact / model quips return copy', () => {
    expect(continuePhrase().length).toBeGreaterThan(0)
    expect(compactPhrase().length).toBeGreaterThan(0)
    expect(modelQuip('deepseek-chat')).not.toBeNull()
    expect(modelQuip('unknown-model-xyz')).toBeNull()
  })
})
