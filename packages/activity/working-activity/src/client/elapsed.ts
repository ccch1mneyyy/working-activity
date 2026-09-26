/**
 * Client-side elapsed re-tick for the working line.
 *
 * The projection is event-driven: the host pushes a value when a committed
 * event folds, and `view` renders at read time. The TUI creates its own
 * cadence by re-reading; a browser cannot, so between folds the shipped
 * `line` ages — measured on the rc.2 corridor, one turn carried three
 * pushes, freezing the elapsed text for the length of a tool. While `live`
 * is true, the dock row therefore re-ticks the ONE moving segment locally:
 * the elapsed counter.
 *
 * Safety: a segment is replaced only when it matches the shapes the host
 * emits (`总1m23s` / `total 5s` / a bare `87ms`). Any format drift on the
 * host side makes the matcher miss and the row falls back to the host's
 * (aging) text — stale, but never wrong. Settled `✓` lines carry a fixed
 * duration, not a counter, and are left alone. This module is deliberately
 * dependency-free: the host's `phrases.ts` reaches node builtins for
 * language detection, which the client bundle's purity gate rejects.
 * @module @deepseek-ai/dsh-working-activity/client/elapsed
 */

/** What the caller knows about the value whose line is displayed. */
export interface ElapsedTickView {
  /** Current phase; only live phases carry a moving counter. */
  readonly phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  /** Wall clock the current phase began (the tool counter counts from it). */
  readonly phaseStartedAt: number
  /** Wall clock the current turn began (the elapsed counter counts from it). */
  readonly turnStartedAt: number
  /** Language the host rendered `line` in. */
  readonly lang: 'zh' | 'en'
}

/** The duration shapes the host emits: `87ms`, `5s`, `1m23s`, `4h0m`. */
const DURATION = /^\d+(?:ms|s|m\d+s|h\d+m)$/
/** The localized elapsed segment: `总5s`, `total 1m23s`. */
const ELAPSED = /^(?:总|total )\d+(?:ms|s|m\d+s|h\d+m)$/
/** The segment separator the host composes the line with. */
const SEP = ' · '

/** Mirror of the host's `fmtDuration` (second granularity and shapes). */
function formatDuration(ms: number): string {
  if (ms < 1000) return '0s'
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}m${seconds}s`
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

/** Mirror of the host's `durationLabel` (sub-second reads in milliseconds). */
function formatCounter(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.floor(ms))}ms` : formatDuration(ms)
}

/**
 * Replace the line's elapsed segment with one computed at `nowMs`.
 *
 * @param line - The host-rendered line (aged to the last fold).
 * @param view - The value's phase, counters and language.
 * @param nowMs - Wall clock to re-tick to.
 * @returns the line with a current counter, or the input when there is
 * nothing safe to replace.
 */
export function refreshElapsedSuffix(line: string, view: ElapsedTickView, nowMs: number): string {
  if (view.phase === 'idle' || view.phase === 'done') return line
  // A settled tool's `✓ … · 887ms` is a fixed fact, not a counter.
  if (line.startsWith('✓ ')) return line
  // The tool counter counts from the phase's entry; with concurrent tools the
  // host's own counter tracks the OLDEST one, so this may trail it by the
  // overlap — a display nuance, not a wrong number.
  const since = view.phase === 'tool' ? view.phaseStartedAt : view.turnStartedAt
  if (!(since > 0)) return line
  const elapsed = Math.max(0, nowMs - since)
  const replacement = view.phase === 'tool'
    ? formatCounter(elapsed)
    : (view.lang === 'en' ? `total ${formatDuration(elapsed)}` : `总${formatDuration(elapsed)}`)
  const segments = line.split(SEP)
  for (let i = segments.length - 1; i > 0; i--) {
    const segment = segments[i]
    if (segment !== undefined && (DURATION.test(segment) || ELAPSED.test(segment))) {
      segments[i] = replacement
      return segments.join(SEP)
    }
  }
  return line
}
