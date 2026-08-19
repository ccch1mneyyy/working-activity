/**
 * Config-parsing tests: the pi-style `working-activity.json` shape —
 * frames / customPhrases / customActions / mode / features and the
 * featureOn gate.
 * @module @deepseek-ai/dsh-working-activity/tests/config
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTIVITY_CONFIG, featureOn, normalizeThresholds, parseWorkingActivityConfig,
} from '../src/config.ts'

describe('parseWorkingActivityConfig', () => {
  it('parses a full valid config', () => {
    const { config, raw } = parseWorkingActivityConfig(JSON.stringify({
      frames: 'whale-bubbles',
      mode: 'minimal',
      features: { rareEggs: false, cost: true },
      customPhrases: ['自定义一条', '', '另一条'],
      customActions: { my_tool: ['干我的活', '  '] },
      narrate: false,
    }))
    expect(config.frames).toBe('whale-bubbles')
    expect(config.mode).toBe('minimal')
    expect(config.features).toEqual({ rareEggs: false, cost: true })
    expect(config.customPhrases).toEqual(['自定义一条', '另一条'])
    expect(config.customActions).toEqual({ my_tool: ['干我的活'] })
    expect(config.narrate).toBe(false)
    expect(raw.frames).toBe('whale-bubbles')
  })

  it('rejects an unknown frames value (falls back to default)', () => {
    const { config } = parseWorkingActivityConfig('{"frames":"no-such-preset"}')
    expect(config.frames).toBe(DEFAULT_ACTIVITY_CONFIG.frames)
  })

  it('accepts random frames', () => {
    const { config } = parseWorkingActivityConfig('{"frames":"random"}')
    expect(config.frames).toBe('random')
  })

  it('rejects invalid mode and non-boolean features', () => {
    const { config } = parseWorkingActivityConfig('{"mode":"turbo","features":{"rareEggs":"yes"}}')
    expect(config.mode).toBeUndefined()
    expect(config.features).toBeUndefined()
  })

  it('reports an error for a non-object root and for bad JSON', () => {
    expect(parseWorkingActivityConfig('"hi"').error).toBeDefined()
    expect(parseWorkingActivityConfig('{oops').error).toBeDefined()
  })

  it('clamps danger threshold below warn threshold', () => {
    const { config } = parseWorkingActivityConfig('{"contextWarnAt":90,"contextDangerAt":50}')
    expect(config.contextDangerAt).toBe(90)
  })
})

describe('normalizeThresholds', () => {
  it('leaves sane thresholds untouched', () => {
    const cfg = normalizeThresholds({ contextWarnAt: 70, contextDangerAt: 90 })
    expect(cfg.contextDangerAt).toBe(90)
  })
})

describe('featureOn', () => {
  it('explicit features win over mode', () => {
    const config = { mode: 'minimal' as const, features: { rareEggs: true } }
    expect(featureOn(config, 'rareEggs')).toBe(true)
    expect(featureOn(config, 'weekend')).toBe(false)
  })

  it('cost is always on', () => {
    expect(featureOn({ mode: 'minimal' as const }, 'cost')).toBe(true)
    expect(featureOn({ mode: 'lively' as const }, 'cost')).toBe(true)
  })

  it('lively defaults everything on', () => {
    expect(featureOn({ mode: 'lively' as const }, 'holidays')).toBe(true)
    expect(featureOn({}, 'holidays')).toBe(true)
  })
})
