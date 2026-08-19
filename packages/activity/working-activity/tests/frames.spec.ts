/**
 * Frame-preset tests: the union of the pi extension and dsh-tui presets,
 * resolve behavior, and frame-shape sanity.
 * @module @deepseek-ai/dsh-working-activity/tests/frames
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRESET, FRAME_PRESETS, PRESET_NAMES, isPresetName, resolvePreset,
} from '../src/frames.ts'

describe('FRAME_PRESETS', () => {
  it('carries the full pi + dsh-tui union (35 presets)', () => {
    expect(Object.keys(FRAME_PRESETS)).toHaveLength(35)
  })

  it('includes the pi-only bar2 and every dsh-tui addition', () => {
    for (const name of [
      'claude', 'bar2', 'moon8', 'rainbow',
      'whale-spout', 'whale-spin', 'whale-bubbles', 'clock', 'traffic_lights',
    ]) {
      expect(FRAME_PRESETS[name], name).toBeDefined()
    }
  })

  it('every preset has non-empty frames and a positive interval', () => {
    for (const [name, preset] of Object.entries(FRAME_PRESETS)) {
      expect(preset.frames.length, name).toBeGreaterThan(0)
      expect(preset.intervalMs, name).toBeGreaterThan(0)
    }
  })

  it('whale-bubbles keeps a stable display width across frames', () => {
    const width = (frame: string): number =>
      [...frame].reduce((total, char) => total + (char.codePointAt(0)! > 0x2fff ? 2 : 1), 0)
    const widths = new Set(FRAME_PRESETS['whale-bubbles'].frames.map(width))
    expect(widths.size).toBe(1)
  })
})

describe('isPresetName', () => {
  it('accepts known names and random, rejects others', () => {
    expect(isPresetName('moon8')).toBe(true)
    expect(isPresetName('random')).toBe(true)
    expect(isPresetName('no-such-preset')).toBe(false)
  })
})

describe('resolvePreset', () => {
  it('falls back to the default for absent or unknown names', () => {
    expect(resolvePreset(undefined)).toBe(FRAME_PRESETS[DEFAULT_PRESET])
    expect(resolvePreset('no-such-preset')).toBe(FRAME_PRESETS[DEFAULT_PRESET])
  })

  it('resolves random to a known preset every time', () => {
    for (let i = 0; i < 50; i++) {
      expect(Object.values(FRAME_PRESETS)).toContain(resolvePreset('random'))
    }
  })

  it('lists random first in PRESET_NAMES', () => {
    expect(PRESET_NAMES[0]).toBe('random')
    expect(PRESET_NAMES.length).toBe(Object.keys(FRAME_PRESETS).length + 1)
  })
})
