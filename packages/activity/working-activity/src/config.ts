/**
 * Working-activity user configuration, mirroring the pi extension's
 * `~/.pi/agent/working-activity.json` shape: the UI owns the file (dsh-tui
 * persists `frames` at `~/.dsh-tui/working-activity.json`) and consumers use
 * the pure parser here to honor `mode` / `features` / `customPhrases` /
 * `customActions` without duplicating validation. No I/O — filesystem
 * ownership stays with the host.
 * @module @deepseek-ai/dsh-working-activity/config
 */

import { DEFAULT_PRESET, isPresetName } from './frames.js'

/** Feature flags that can be switched independently (pi extension parity). */
export const FEATURE_FLAGS = [
  'phrases',          // 俏皮文案池（思考/等待/收尾/工具动词）
  'rareEggs',         // 稀有彩虹彩蛋
  'nightPhrases',     // 深夜文案
  'weekend',          // 周末问候
  'holidays',         // 节假日彩蛋
  'combo',            // 连击火力全开
  'failPhrases',      // 失败文案池
  'modelQuips',       // 模型切换梗
  'shimmer',          // 文案星辉扫过/彩虹流光
  'continuePhrases',  // 打断后接梗
  'cost',             // 成本与 token 核算（结束时展示）
] as const

/** Feature-flag name type. */
export type FeatureFlag = (typeof FEATURE_FLAGS)[number]

/** Chinese labels for the settings panel / docs. */
export const FEATURE_LABELS: Record<FeatureFlag, string> = {
  phrases: '俏皮文案',
  rareEggs: '稀有彩蛋',
  nightPhrases: '深夜文案',
  weekend: '周末问候',
  holidays: '节假日彩蛋',
  combo: '工具连击',
  failPhrases: '失败文案',
  modelQuips: '模型切换梗',
  shimmer: '星辉效果',
  continuePhrases: '打断接梗',
  cost: '成本与 token',
}

/** The file-based config, same keys as the pi extension. */
export type WorkingActivityConfig = {
  /** Frame preset name (`random` picks one per process). */
  frames?: string
  /** Extra thinking phrases appended to the base pool. */
  customPhrases?: readonly string[]
  /** Exact tool-name → action-copy pools (case-insensitive match). */
  customActions?: Readonly<Record<string, readonly string[]>>
  /** Inject the `⏵` self-narration contract into the system prompt. */
  narrate?: boolean
  /** Debug logging to `working-activity-debug.log`. */
  debugLog?: boolean
  /** Context usage warning threshold in percent. */
  contextWarnAt?: number
  /** Context usage danger threshold in percent. */
  contextDangerAt?: number
  /** Show estimated output tokens per second. */
  showTokPerSec?: boolean
  /** Hourly work-reminder threshold (0–24, 0 = off). */
  workRemindAt?: number
  /** lively: full flourish (default) / minimal: functional labels only. */
  mode?: 'lively' | 'minimal'
  /** Per-feature switches; explicit values override `mode` defaults. */
  features?: Readonly<Record<string, boolean>>
}

/** The defaults when nothing is configured. */
export const DEFAULT_ACTIVITY_CONFIG: WorkingActivityConfig = {
  frames: DEFAULT_PRESET,
  narrate: true,
}

/** Result of parsing a config file. */
export type ConfigReadResult = {
  readonly config: WorkingActivityConfig
  /** Raw parsed object, preserving unknown keys for lossless write-back. */
  readonly raw: Record<string, unknown>
  /** Parse error message, when the text was not a valid config object. */
  readonly error?: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Clamp `dangerAt` to be at least `warnAt` (percent thresholds). */
export function normalizeThresholds(cfg: WorkingActivityConfig): WorkingActivityConfig {
  const warnAt = cfg.contextWarnAt ?? 80
  const dangerAt = cfg.contextDangerAt ?? 95
  return dangerAt < warnAt ? { ...cfg, contextDangerAt: warnAt } : cfg
}

/**
 * Parse a `working-activity.json` text into a validated config. Unknown keys
 * are preserved in `raw` (for lossless write-back); invalid values are
 * dropped. A non-object root yields the defaults plus an `error`.
 * @param text - Raw file contents.
 * @returns Validated config + raw object (+ optional error).
 */
export function parseWorkingActivityConfig(text: string): ConfigReadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { config: { ...DEFAULT_ACTIVITY_CONFIG }, raw: {}, error: errorText(error) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      config: { ...DEFAULT_ACTIVITY_CONFIG },
      raw: {},
      error: '配置根节点必须是 JSON 对象',
    }
  }
  const raw = parsed as Record<string, unknown>
  const config: WorkingActivityConfig = { ...DEFAULT_ACTIVITY_CONFIG }
  if (typeof raw.frames === 'string' && isPresetName(raw.frames)) config.frames = raw.frames
  if (Array.isArray(raw.customPhrases)) {
    const phrases = raw.customPhrases.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    if (phrases.length > 0) config.customPhrases = phrases
  }
  if (raw.customActions !== null && typeof raw.customActions === 'object' && !Array.isArray(raw.customActions)) {
    const customActions: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(raw.customActions)) {
      const actions = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim())
        : []
      if (key.trim().length > 0 && actions.length > 0) customActions[key.trim()] = actions
    }
    if (Object.keys(customActions).length > 0) config.customActions = customActions
  }
  if (typeof raw.narrate === 'boolean') config.narrate = raw.narrate
  if (typeof raw.debugLog === 'boolean') config.debugLog = raw.debugLog
  if (typeof raw.contextWarnAt === 'number' && Number.isFinite(raw.contextWarnAt)
    && raw.contextWarnAt >= 0 && raw.contextWarnAt <= 100) {
    config.contextWarnAt = raw.contextWarnAt
  }
  if (typeof raw.contextDangerAt === 'number' && Number.isFinite(raw.contextDangerAt)
    && raw.contextDangerAt >= 0 && raw.contextDangerAt <= 100) {
    config.contextDangerAt = raw.contextDangerAt
  }
  if (typeof raw.showTokPerSec === 'boolean') config.showTokPerSec = raw.showTokPerSec
  if (typeof raw.workRemindAt === 'number' && Number.isFinite(raw.workRemindAt)
    && raw.workRemindAt >= 0 && raw.workRemindAt <= 24) {
    config.workRemindAt = raw.workRemindAt
  }
  if (raw.mode === 'lively' || raw.mode === 'minimal') config.mode = raw.mode
  if (raw.features !== null && typeof raw.features === 'object' && !Array.isArray(raw.features)) {
    const features: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(raw.features)) {
      if (typeof value === 'boolean') features[key] = value
    }
    if (Object.keys(features).length > 0) config.features = features
  }
  return { config: normalizeThresholds(config), raw }
}

/**
 * Whether a feature is on. Explicit `features` entries win; otherwise
 * `minimal` mode turns everything off (except `cost`, always on).
 * @param config - Parsed config.
 * @param name - Feature flag name.
 */
export function featureOn(config: WorkingActivityConfig, name: FeatureFlag): boolean {
  const explicit = config.features?.[name]
  if (typeof explicit === 'boolean') return explicit
  if (name === 'cost') return true
  return config.mode !== 'minimal'
}
