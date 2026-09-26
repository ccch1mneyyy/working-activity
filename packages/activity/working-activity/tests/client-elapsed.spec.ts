/**
 * The Web row's local elapsed re-tick: replace the ONE moving segment of the
 * host-rendered line, and never anything else. These cases pin both sides of
 * that contract — the counter advances, and every non-counter shape (settled
 * durations, done summaries, unknown formats) passes through untouched.
 * @module @deepseek-ai/dsh-working-activity/tests/client-elapsed
 */

import { describe, expect, it } from 'vitest'
import { refreshElapsedSuffix } from '../src/client/elapsed.ts'

const BASE = 1_700_000_000_000

function view(overrides: Partial<Parameters<typeof refreshElapsedSuffix>[1]> = {}) {
  return {
    phase: 'thinking',
    phaseStartedAt: BASE - 5_000,
    turnStartedAt: BASE - 5_000,
    lang: 'zh',
    ...overrides,
  } as const
}

describe('refreshElapsedSuffix', () => {
  it('re-ticks the localized elapsed segment', () => {
    expect(refreshElapsedSuffix('脑子冒泡泡 · 总5s', view(), BASE)).toBe('脑子冒泡泡 · 总5s')
    expect(refreshElapsedSuffix('脑子冒泡泡 · 总5s', view(), BASE + 61_000)).toBe('脑子冒泡泡 · 总1m6s')
  })

  it('re-ticks the English segment in English', () => {
    expect(
      refreshElapsedSuffix('mulling it over · total 5s', view({ lang: 'en' }), BASE + 2_000),
    ).toBe('mulling it over · total 7s')
  })

  it('re-ticks a running tool counter even with trailing segments', () => {
    const line = '跑个命令 npm test · 800ms · git main · 工具x2'
    expect(refreshElapsedSuffix(line, view({ phase: 'tool', phaseStartedAt: BASE - 800 }), BASE + 3_200))
      .toBe('跑个命令 npm test · 4s · git main · 工具x2')
  })

  it('keeps a settled tool line untouched (a fixed fact, not a counter)', () => {
    const line = '✓ 跑个命令 npm test · 887ms'
    expect(refreshElapsedSuffix(line, view(), BASE + 5_000)).toBe(line)
  })

  it('keeps settled phases and unknown formats untouched', () => {
    const done = '搞定 ✓ · 3 工具 · 想12s 干11s'
    expect(refreshElapsedSuffix(done, view({ phase: 'done' }), BASE + 60_000)).toBe(done)
    // No segment matches the host's elapsed shapes → the host text wins.
    const odd = 'something · 后面还有话'
    expect(refreshElapsedSuffix(odd, view(), BASE + 60_000)).toBe(odd)
  })

  it('formats the same shapes the host does', () => {
    expect(refreshElapsedSuffix('脑子冒泡泡 · 总0s', view({ turnStartedAt: BASE - 87 }), BASE))
      .toBe('脑子冒泡泡 · 总0s')
    expect(refreshElapsedSuffix('跑命令 ls · 0s', view({ phase: 'tool', phaseStartedAt: BASE - 87 }), BASE))
      .toBe('跑命令 ls · 87ms')
    expect(refreshElapsedSuffix('等等 · 总0s', view({ turnStartedAt: BASE - 3_723_000 }), BASE))
      .toBe('等等 · 总1h2m')
  })
})
