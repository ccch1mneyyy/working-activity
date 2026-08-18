/**
 * Language resolution + copy dictionary for the working-activity plugin.
 *
 * The plugin follows the dsh-tui UI language without importing it: the same
 * chain dsh-tui resolves (`DSH_TUI_LANG` env → `~/.dsh-tui/lang.json` → OS
 * locale → zh) is read here directly, so a `/lang en|zh` switch (or the
 * /settings language pick) hot-swaps this plugin's narration and status-line
 * copy on the next render tick.
 *
 * Resolution order:
 *   1. `setLangOverride()` — a plugin-level `lang: zh|en` config key
 *      (cordis.yml) or an explicit test pin.
 *   2. `DSH_TUI_LANG` env var — pinned at process start.
 *   3. `~/.dsh-tui/lang.json` — the persisted dsh-tui choice, mtime-cached
 *      so the per-tick status render never re-reads an unchanged file.
 *   4. OS locale guess (`LC_ALL` / `LC_MESSAGES` / `LANG`); POSIX/C means
 *      "no locale selected" and maps to English.
 *   5. `zh` — the original hard-coded language.
 *
 * The dictionary is a flat key → per-language string map; `t(key, params)`
 * substitutes `{{name}}` placeholders. Missing keys render the key itself so
 * a typo is visible instead of silently blank.
 * @module @deepseek-ai/dsh-working-activity/lang
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Lang = 'zh' | 'en'

/** The languages shipped with the plugin, in display order. */
export const LANGS = ['zh', 'en'] as const

/** The dsh-tui prefs file this plugin mirrors (shared language contract). */
const LANG_FILE = join(homedir(), '.dsh-tui', 'lang.json')

const dict = {
  // ── ⏵ self-narration contract (system prompt, /lang aware) ──────────
  'narrate-instruction': {
    zh: '[状态栏] 你有一个状态栏展示给用户。【必须】在每个步骤/子任务开始时（不只是调用工具前），在回复正文的最前面单独写一行：⏵ 你在做的具体事情（不超过20字），然后换行继续正常回复。整轮回复只写一行 ⏵，不要重复。信息为主——让人一眼知道你在干什么，风格自然、可以带点俏皮。例：⏵ 修复登录页样式、⏵ 查一下报错原因、⏵ 给补丁跑个验证。切换任务时必须更新。',
    en: '[Status line] You have a status line visible to the user. [Required] At the start of each step or subtask (not only before tool calls), write exactly one standalone line at the very beginning of your response: ⏵ a concrete description of what you are doing (20 words max), then continue with the normal response on the next line. Write only one ⏵ line per response and do not repeat it. Prioritize information so the user can understand the current work at a glance; keep the style natural and optionally playful. Examples: ⏵ Fixing the login page styles, ⏵ Investigating the error, ⏵ Running validation for the patch. Update it when the task changes.',
  },

  // ── status-line structural copy ─────────────────────────────────────
  /** Plain (non-playful) phase labels. */
  'waiting-label': { zh: '等待模型响应', en: 'Waiting for model' },
  'thinking-label': { zh: '思考中', en: 'Thinking' },
  /** Elapsed suffix: zh glues the char, en keeps a space. */
  'line-elapsed': { zh: '总{{elapsed}}', en: 'total {{elapsed}}' },
  /** Plain-mode completion prefix (playful pools pick their own). */
  'done-prefix': { zh: '搞定 ✓', en: 'Finished' },
  /** Turn-completion summary. */
  'done-summary': {
    zh: '{{tools}} · 想{{thinking}} 干{{tooling}}',
    en: '{{tools}} · thought {{thinking}} worked {{tooling}}',
  },
  'tool-count-one': { zh: '{{count}} 工具', en: '{{count}} tool' },
  'tool-count-many': { zh: '{{count}} 工具', en: '{{count}} tools' },
} as const

export type I18nKey = keyof typeof dict
export type I18nParams = Record<string, string | number>

/** Explicit pin set by plugin config or tests; `auto` restores the chain. */
let override: Lang | 'auto' = 'auto'

/** Force (or release) the active language; `auto` re-enables the chain. */
export function setLangOverride(lang: Lang | 'auto'): void {
  override = lang
}

/** The currently active language. */
export function langNow(): Lang {
  if (override !== 'auto') return override
  const env = process.env.DSH_TUI_LANG
  if (env === 'zh' || env === 'en') return env
  return readLangFile() ?? detectLocaleLang()
}

/** Translate a dictionary key, substituting `{{name}}` placeholders. */
export function t(key: I18nKey, params: I18nParams = {}): string {
  const entry = dict[key] as { zh: string; en: string } | undefined
  const template = entry?.[langNow()] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** Is a value a valid shipped language code? */
export function isLang(value: unknown): value is Lang {
  return value === 'zh' || value === 'en'
}

/**
 * Read the persisted dsh-tui language choice, mtime-cached so the per-tick
 * status render never re-reads an unchanged file. `undefined` when the file
 * is absent or holds no valid `{ lang }` value.
 */
export function readLangFile(): Lang | undefined {
  let mtimeMs: number
  try {
    mtimeMs = statSync(LANG_FILE).mtimeMs
  } catch {
    return undefined
  }
  if (cachedMtime === mtimeMs) return cachedLang
  try {
    const parsed: unknown = JSON.parse(readFileSync(LANG_FILE, 'utf8'))
    const lang = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).lang
      : undefined
    cachedLang = isLang(lang) ? lang : undefined
  } catch {
    cachedLang = undefined
  }
  cachedMtime = mtimeMs
  return cachedLang
}

let cachedMtime = -1
let cachedLang: Lang | undefined

/**
 * Guess the language from the OS locale (`LC_ALL`, `LC_MESSAGES`, `LANG`),
 * defaulting to `zh`. POSIX/C means "no locale selected" and conventionally
 * maps to English (what CI runners report). An absent locale variable
 * (typical on Windows) defaults to `zh`.
 */
export function detectLocaleLang(): Lang {
  const raw =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    ''
  const locale = raw.split('.')[0]?.toLowerCase() ?? ''
  if (locale.startsWith('zh')) return 'zh'
  if (locale.startsWith('en')) return 'en'
  if (locale === 'c' || locale === 'posix') return 'en'
  return 'zh'
}
