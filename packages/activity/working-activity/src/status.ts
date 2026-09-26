/**
 * Pure activity state machine for the working-activity status line. Consumes
 * session events (turn/step/tool/stream) plus agent running/idle transitions
 * and renders a human-readable status line at any wall-clock instant. No I/O,
 * no timers, no cordis — deterministic given the event stream and a clock.
 * @module @deepseek-ai/dsh-working-activity/status
 */

import type { ActivityEvent, WaitingReason } from './activity-event.js'
import {
  actionFor, compactPhrase, continuePhrase, donePhrase, failPhrase, fmtDuration,
  holidayPhrase, isGitTool, isNight, isWeekend, mixSlot, modelQuip, overflowPhrase, rarePhrase,
  RARE_CHANCE, thinkingPhrase, toolOpeningPhrase, weekendPhrase, waitingPhrase, waitingReasonPhrase,
  type PhraseSlot,
} from './phrases.js'
import { feedSessionEvent } from './compat/session-events.js'
import { t } from './lang.js'

/** Public status phases a UI can render. */
export type ActivityPhase = 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'

/**
 * Compatibility handle for {@link ActivityTracker.snapshot} output.
 *
 * The snapshot shape is private to this module; this number is the only part a
 * consumer may rely on. Bump it whenever the emitted shape changes, so a
 * persisted projection checkpoint from an older build is discarded (the host
 * refolds the log) instead of being misread as the new shape.
 */
export const TRACKER_SNAPSHOT_VERSION = 6

/** One snapshot of the model's activity, renderable by any UI. */
export interface ActivityState {
  /** Which activity phase the model is in right now. */
  readonly phase: ActivityPhase
  /** Full human-readable status line (plain text, no ANSI). */
  readonly line: string
  /** Short label of the current work (tool action or stage), when any. */
  readonly label?: string
  /** Detail fragment (path / command / search pattern), when any. */
  readonly detail?: string
  /** The playful phrase currently shown. */
  readonly phrase?: string
  /** Tools completed in the current turn. */
  readonly toolCount: number
  /** Wall-clock milliseconds since the current turn started (0 when idle). */
  readonly turnElapsedMs: number
  /** Wall-clock time the current phase started, for animations. */
  readonly phaseStartedAt: number
}

/** Per-turn thinking/tooling split, exposed for done summaries and stats. */
export interface TurnStats {
  /** Milliseconds the model was thinking (between turn start and first tool / turn end). */
  readonly thinkingMs: number
  /** Milliseconds spent inside tool executions. */
  readonly toolMs: number
  /** Tools completed in the turn. */
  readonly toolCount: number
}

/** Easter-egg toggles for the thinking phrase (pi extension parity). */
export interface TrackerFeatures {
  /** Rare 1/150 easter eggs. */
  readonly rareEggs?: boolean
  /** Weekend greetings on Sat/Sun. */
  readonly weekend?: boolean
  /** Date-matched holiday / Lunar New Year copy. */
  readonly holidays?: boolean
  /** Night-owl copy between 00:00 and 06:00. */
  readonly nightPhrases?: boolean
  /** Consecutive-tool streak badge. */
  readonly combo?: boolean
  /** Playful failure copy when the turn's last tool failed. */
  readonly failPhrases?: boolean
  /** Quips on a model route change. */
  readonly modelQuips?: boolean
  /** Comeback quip after the user interrupts. */
  readonly continuePhrases?: boolean
}

/** Configuration knobs for the state machine (subset of plugin Config). */
export interface TrackerConfig {
  /** Playful copy pool on/off; false renders plain functional labels. */
  readonly phrases: boolean
  /** Maximum characters of a detail fragment (paths/commands). */
  readonly detailLimit: number
  /** Hide the status line while idle. */
  readonly showIdle: boolean
  /** Easter-egg toggles; absent flags default to on. */
  readonly features?: TrackerFeatures
  /** User custom phrases appended to the base thinking pool. */
  readonly customPhrases?: readonly string[]
  /** Show an estimated tokens/s prefix while streaming (pi parity). */
  readonly showTokPerSec?: boolean
  /** Work reminder after this many turn-hours (0 = off). */
  readonly workRemindAt?: number
}

/** A tool execution in flight. */
interface ActiveTool {
  readonly callId: string
  readonly name: string
  readonly action: string
  readonly detail: string
  readonly isGit: boolean
  readonly startedAt: number
  /** Whether the tool failed; set on tool/result while the card lingers. */
  failed: boolean
  /** tool/result time when settled, else undefined. */
  endedAt?: number
}

/** A tool that finished but keeps its card in the replay queue. */
interface DoneTool {
  readonly action: string
  readonly detail: string
  readonly failed: boolean
  readonly endedAt: number
  /** How long the tool ran; shown while the settled line lingers. */
  readonly durationMs: number
}

/**
 * The wire shape of {@link ActivityTracker.snapshot} — module-private on
 * purpose. Consumers hand the value straight back to
 * {@link ActivityTracker.restore}; `snapshot()` is typed as `unknown` so the
 * field list never becomes published API that has to be kept stable.
 */
interface TrackerSnapshotShape {
  readonly version: number
  readonly phase: ActivityPhase
  readonly phaseStartedAt: number
  readonly turnStartedAt: number
  readonly thinkingStartedAt: number
  readonly thinkingMs: number
  readonly toolMs: number
  readonly toolCount: number
  readonly activeTools: readonly ActiveTool[]
  readonly doneQueue: readonly DoneTool[]
  /** Thinking phases entered this turn — the rare egg shows in the first one. */
  readonly thinkingPhases: number
  /** When the turn's first tool started (drives the thinking→doing opening line). */
  readonly firstToolStartedAt: number
  readonly waitingFirstToken: boolean
  /** When the first streamed token arrived (0 = none yet; live-only on rc.2). */
  readonly firstTokenAt: number
  readonly narratedText: string | null
  readonly lastChunkAt: number
  readonly recentStream: string
  readonly turnTokens: number
  readonly donePrefix: string
  readonly pendingPhrase: string | null
  readonly pendingUntil: number
  readonly gitBranch: string | null
  /** Last announced model route, so a restored tracker keeps the dedupe. */
  readonly model: string | null
  readonly streak: number
  readonly lastToolEndAt: number
  readonly maxStreak: number
  readonly subagentCount: number
  /** Current stall, or null (`WaitingReason` for the reason). */
  readonly waitingReason: WaitingReason | null
  /** When the current stall began (0 with none). */
  readonly waitingReasonAt: number
  readonly tokBuf: number
  readonly tokWindowStart: number
}

/** Format one tool into its display fragment (`跑个命令 npm test`). */
function toolFragment(tool: { action: string; detail: string }): string {
  return tool.detail.length === 0 ? tool.action : `${tool.action} ${tool.detail}`
}

/** The phase vocabulary, for snapshot shape validation (see {@link ActivityTracker.restore}). */
const PHASES: readonly ActivityPhase[] = ['idle', 'waiting', 'thinking', 'tool', 'done']

/** Whether `value` is one of {@link PHASES}. */
function isPhase(value: unknown): value is ActivityPhase {
  return PHASES.includes(value as ActivityPhase)
}

/**
 * Duration label for a settled tool: sub-second tools read in milliseconds.
 *
 * The shared `fmtDuration` is second-granular, which renders the measured
 * median tool (87 ms) as a meaningless `0s` — the settled line exists to make
 * that work visible, so it has to say how long it took.
 * @param ms - Tool duration in milliseconds.
 */
function durationLabel(ms: number): string {
  // Floor, not round: 999.6 ms is "999ms", not a "1000ms" that never happened.
  return ms < 1000 ? `${Math.max(0, Math.floor(ms))}ms` : fmtDuration(ms)
}

/** Simple non-ANSI string shortener by grapheme count. */
function shorten(value: string, limit: number): string {
  const graphemes = Array.from(value)
  if (graphemes.length <= limit) return value
  return `${graphemes.slice(0, Math.max(0, limit - 1)).join('')}…`
}

/**
 * Flatten model-written text for the single-line render path.
 *
 * The line is composed from text the model wrote (its `⏵` narration, the path
 * or command inside a tool call), and it is displayed by a terminal and by the
 * Web UI. So this is where that text stops being able to do anything but be
 * read: complete ANSI/OSC sequences go first (stripping only their control
 * bytes would leave `[31m` residue behind), every remaining C0/C1 control char
 * becomes a space — a `\n` inside a multi-line shell command would otherwise
 * split the status line in two — and whitespace collapses, because a render
 * path is one line by definition.
 * @param value - Raw model-written fragment.
 * @returns the fragment, safe and single-line.
 */
function sanitizeFragment(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    // eslint-disable-next-line no-control-regex -- deliberate: model text is untrusted render input
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract a displayable detail fragment from a tool call's parsed arguments.
 * @param toolName - Registry tool name.
 * @param args - Parsed tool arguments (lossless JSON by registry contract).
 */
export function detailFor(toolName: string, args: Readonly<Record<string, unknown>> | undefined, limit: number): string {
  if (args === undefined) return ''
  const pickString = (...keys: readonly string[]): string => {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string' && value.trim().length > 0) return sanitizeFragment(value)
    }
    return ''
  }
  const normalized = toolName.toLowerCase()
  if (normalized === 'mcp' || normalized.startsWith('mcp__') || normalized.includes('__')) {
    const action = pickString('action', 'tool', 'server', 'connect', 'describe')
    return shorten(action, limit)
  }
  const path = pickString('path', 'file', 'file_path', 'filepath', 'target')
  if (path.length > 0) return shorten(path, limit)
  const command = pickString('command', 'cmd', 'cmdline')
  if (command.length > 0) return shorten(command, limit)
  const pattern = pickString('pattern', 'query', 'search')
  if (pattern.length > 0) return shorten(pattern, limit)
  const url = pickString('url')
  if (url.length > 0) return shorten(url, limit)
  if (/^(?:subagent|agent|task)$/i.test(toolName)) {
    const description = pickString('description')
    if (description.length > 0) return shorten(description, limit)
    const prompt = pickString('prompt')
    if (prompt.length > 0) return shorten(prompt, limit)
  }
  const named = pickString('name', 'server', 'tool', 'id', 'goal')
  if (named.length > 0) return shorten(named, limit)
  return ''
}

/**
 * Track one agent's activity from its durable session events. Events from
 * other sessions are ignored (the owning plugin feeds only the agent it
 * displays). The tracker is deliberately single-agent: multi-session UIs
 * instantiate one tracker per agent.
 */
export class ActivityTracker {
  private phase: ActivityPhase = 'idle'
  private phaseStartedAt = 0
  private turnStartedAt = 0
  private thinkingStartedAt = 0
  private thinkingMs = 0
  private toolMs = 0
  private toolCount = 0
  /** When the turn's first tool started; 0 until it does (see {@link toolOpening}). */
  private firstToolStartedAt = 0
  private activeTools = new Map<string, ActiveTool>()
  private doneQueue: DoneTool[] = []
  private thinkingPhases = 0
  private waitingFirstToken = false
  /**
   * When the first streamed token arrived (0 = none yet).
   *
   * Live-only knowledge on the current host line (deltas are frames, not
   * durable events), so the projection learns it through the live overlay —
   * without it the projected line stays in the waiting pool all generation.
   */
  private firstTokenAt = 0
  /** Latest `⏵` self-narration line extracted from the stream, or null. */
  private narratedText: string | null = null
  /** Wall-clock time of the most recent stream delta (narration freshness). */
  private lastChunkAt = 0
  /** Rolling window of VISIBLE text deltas, for `⏵` extraction (see onEvent). */
  private recentStream = ''
  /** Total tokens reported across the turn's assistant messages. */
  private turnTokens = 0
  /** Completion prefix drawn ONCE at turn end so the done line stays stable. */
  private donePrefix = t('done-prefix')
  /** One-off copy pinned by an external event (interrupt / model switch /
   *  compaction / work reminder), shown until it expires. */
  private pendingPhrase: string | null = null
  private pendingUntil = 0
  /** Git branch of the session cwd (fed by the host, best-effort). */
  private gitBranch: string | undefined
  /** Last model route announced, so a repeated selection stays quiet. */
  private model: string | undefined
  /** Consecutive fast tool streak (combo). */
  private streak = 0
  private lastToolEndAt = 0
  private maxStreak = 0
  /** Subagent (agent/task) calls in the current turn. */
  private subagentCount = 0
  /**
   * Why the turn is stalled, when it is (retry / approval / compaction).
   *
   * A stall is state, not decoration: "waiting on the model" and "the model is
   * waiting on YOU" need different copy, so it outranks the phrase pools and
   * survives `phrases: false`.
   */
  private waitingReason: WaitingReason | undefined
  /** When the current stall began (seeds its copy; 0 with no stall). */
  private waitingReasonAt = 0
  /** Streaming token estimate for the tps prefix. */
  private tokBuf = 0
  private tokWindowStart = 0

  /**
   * @param config - Behavioral knobs.
   * @param now - Wall-clock supplier (injectable for tests).
   * @param customActions - Exact-name custom action pools for {@link actionFor}.
   */
  constructor(
    private readonly config: TrackerConfig,
    private readonly now: () => number = Date.now,
    private readonly customActions?: Readonly<Record<string, readonly string[]>>,
  ) {}

  /** Agent transitioned to running/idle. */
  onAgentStatus(status: 'idle' | 'running'): void {
    if (status === 'idle') {
      // The turn end already moved us to the done phase; idle only clears the
      // lingering done card after its display window.
      if (this.phase !== 'done') this.phase = 'idle'
      return
    }
    if (this.phase === 'idle') {
      this.phase = 'waiting'
      this.phaseStartedAt = this.now()
      this.waitingFirstToken = true
      this.firstTokenAt = 0
    }
  }

  /** The user interrupted the running turn: show a comeback quip next. */
  onInterrupted(): void {
    if (!this.config.phrases) return
    if ((this.config.features ?? {}).continuePhrases === false) return
    this.pendingPhrase = continuePhrase()
    this.pendingUntil = this.now() + PENDING_MS
  }

  /**
   * The model was switched: quip for the new model id.
   *
   * Repeats are ignored. A `model/selection` event is logged whenever the host
   * validates a selection — including a re-selection of the current model and
   * every replay of the log — and re-announcing the same model would replace
   * whatever the line is saying with a stale quip.
   */
  onModelSwitch(modelId: string): void {
    if (modelId === this.model) return
    this.model = modelId
    if (!this.config.phrases) return
    if ((this.config.features ?? {}).modelQuips === false) return
    const quip = modelQuip(modelId)
    if (quip !== null) {
      this.pendingPhrase = quip
      this.pendingUntil = this.now() + PENDING_MS
    }
  }

  /** A context compaction finished (or overflowed): quip about it. */
  onCompact(kind: 'done' | 'overflow'): void {
    // The compaction stall (if any) is over either way.
    if (this.waitingReason === 'compaction') this.clearWaitingReason()
    if (!this.config.phrases) return
    this.pendingPhrase = kind === 'overflow' ? overflowPhrase() : compactPhrase()
    this.pendingUntil = this.now() + PENDING_MS
  }

  /** Feed the session cwd's git branch (best-effort, host-resolved). */
  onGitBranch(branch: string | undefined): void {
    this.gitBranch = branch
  }

  /**
   * Consume one normalized activity event. This is the state machine's only
   * input: host payload shapes are normalized in `src/compat/*` first, so a
   * host-line drift never reaches this switch.
   */
  onEvent(event: ActivityEvent): void {
    switch (event.kind) {
      case 'turn-start': {
        const at = event.at
        this.turnStartedAt = at
        this.thinkingStartedAt = at
        this.thinkingMs = 0
        this.toolMs = 0
        this.toolCount = 0
        this.turnTokens = 0
        this.activeTools.clear()
        this.doneQueue = []
        this.waitingFirstToken = true
        this.firstTokenAt = 0
        this.narratedText = null
        this.lastChunkAt = 0
        this.recentStream = ''
        // Eggs are once-per-turn and derived from the turn's seed, so a fresh
        // turn only needs its phase counter cleared.
        this.thinkingPhases = 0
        this.firstToolStartedAt = 0
        // Per-turn stats reset; the pending quip (interrupt/model/compact)
        // survives across the turn boundary so it shows on the next think.
        this.streak = 0
        this.maxStreak = 0
        this.subagentCount = 0
        this.clearWaitingReason()
        this.tokBuf = 0
        this.tokWindowStart = at
        this.setPhase('waiting', at)
        return
      }
      case 'step-start':
        // No phase change of its own: a step without streamed output stays
        // waiting until its first delta promotes it.
        return
      case 'stream-start':
        // A new attempt must not inherit the previous attempt's provisional
        // text: the narration buffer and the token estimate are attempt-scoped.
        // The phase is untouched — the first delta promotes waiting → thinking.
        this.recentStream = ''
        this.narratedText = null
        this.tokBuf = 0
        this.lastChunkAt = 0
        return
      case 'stream-delta': {
        const at = event.at
        this.lastChunkAt = at
        // Output is flowing again — whatever stalled the turn is over.
        this.clearWaitingReason()
        this.promoteFirstToken(at)
        // Streaming token estimate for the tps prefix (pi parity).
        this.tokBuf += estimateTokens(event.text)
        // Only VISIBLE output narrates. The injected contract asks for the `⏵`
        // line at the beginning of the *response body*, and the durable path
        // (`assistant-settled`) already reads text blocks only — folding
        // reasoning deltas in here made the line quote the model's private
        // thinking back at the user. Reported live: the status line showed a
        // half sentence from reasoning, because thinking about this very
        // format means writing `⏵` about it.
        if (event.stream !== 'text') return
        this.recentStream = (this.recentStream + event.text).slice(-STREAM_BUFFER_CHARS)
        const narration = extractNarration(this.recentStream)
        if (narration !== null) this.narratedText = narration
        return
      }
      case 'stream-reset': {
        // An abandoned attempt (or a partial settlement) must not leave its
        // provisional narration or token estimate behind for the next attempt.
        this.recentStream = ''
        this.narratedText = null
        this.tokBuf = 0
        this.lastChunkAt = 0
        this.waitingFirstToken = true
        this.firstTokenAt = 0
        if (this.activeTools.size === 0) this.setPhase('waiting', event.at)
        return
      }
      case 'assistant-settled': {
        const usage = event.usage
        if (usage !== undefined) {
          this.turnTokens += usage.inputTokens + usage.outputTokens
            + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
        }
        // A settled message proves tokens existed, so a fold (or replay) that
        // never saw the frames still leaves the waiting pool: the first token
        // really happened, just earlier than this event's timestamp.
        this.promoteFirstToken(event.at)
        // The settled text is where a projection (or a replayed log) recovers
        // the narration: frames are live-only, this event is durable.
        if (event.text !== undefined) {
          const narration = extractNarration(event.text)
          if (narration !== null) {
            this.narratedText = narration
            this.lastChunkAt = event.at
          }
        }
        return
      }
      case 'tool-start': {
        const at = event.at
        if (this.phase === 'thinking' || this.phase === 'waiting') {
          this.thinkingMs += at - this.thinkingStartedAt
        }
        // The turn's first tool is where "thinking" turns into "doing": its
        // opening line is derived from this instant (see toolOpening).
        if (this.firstToolStartedAt === 0) this.firstToolStartedAt = at
        // Combo streak: consecutive tools within COMBO_GAP_MS count up.
        this.streak = (this.lastToolEndAt > 0 && at - this.lastToolEndAt <= COMBO_GAP_MS)
          ? this.streak + 1
          : 1
        if (this.streak > this.maxStreak) this.maxStreak = this.streak
        if (/^(?:subagent|agent|task)$/i.test(event.name)) this.subagentCount += 1
        const parsed = parseArguments(event.arguments)
        const action = this.config.phrases ? actionFor(event.name, this.customActions) : event.name
        const detail = detailFor(event.name, parsed, this.config.detailLimit)
        const active: ActiveTool = {
          callId: event.callId,
          name: event.name,
          action,
          detail,
          isGit: isGitTool(event.name, parsed),
          startedAt: at,
          failed: false,
        }
        this.activeTools.set(event.callId, active)
        this.setPhase('tool', at)
        return
      }
      case 'tool-end': {
        const at = event.at
        const callId = event.callId
        const active = this.activeTools.get(callId)
        if (active === undefined) return
        active.failed = event.failed
        active.endedAt = at
        this.toolMs += at - active.startedAt
        this.toolCount += 1
        this.lastToolEndAt = at
        this.doneQueue.push({
          action: active.action,
          detail: active.detail,
          failed: active.failed,
          endedAt: at,
          // Kept so the settled line can show how long it took: on real
          // sessions the median tool is 87 ms, so the duration is most of what
          // there is to read.
          durationMs: Math.max(0, at - active.startedAt),
        })
        if (this.doneQueue.length > DONE_QUEUE_MAX) this.doneQueue.shift()
        this.activeTools.delete(callId)
        // An approval-parked tool resolved the moment it settled.
        if (this.waitingReason === 'approval') this.clearWaitingReason()
        if (this.activeTools.size === 0) {
          // Back to thinking (or a trailing done card if the turn just closed).
          this.setPhase('thinking', at)
          this.thinkingStartedAt = at
        }
        return
      }
      case 'turn-end': {
        const at = event.at
        if (this.activeTools.size > 0) {
          // Tools still running at turn end: count their elapsed time as tool time.
          for (const tool of this.activeTools.values()) {
            this.toolMs += Math.max(0, at - tool.startedAt)
          }
          this.activeTools.clear()
        } else if (this.phase === 'thinking' || this.phase === 'waiting') {
          this.thinkingMs += Math.max(0, at - this.thinkingStartedAt)
        }
        // Draw the completion prefix ONCE so repeated renders of the done line
        // stay stable (a fresh random per render would make it flicker). The
        // pools are language-aware, so the line matches the language the turn
        // ended in.
        const lastTool = this.doneQueue.at(-1)
        if (this.config.phrases) {
          this.donePrefix = lastTool?.failed
            ? ((this.config.features ?? {}).failPhrases !== false ? failPhrase() : t('done-prefix'))
            : donePhrase()
        } else {
          this.donePrefix = t('done-prefix')
        }
        if (event.interrupted === true) this.onInterrupted()
        this.clearWaitingReason()
        this.setPhase('done', at)
        return
      }
      case 'route-change':
        this.onModelSwitch(event.model)
        return
      case 'compaction':
        this.onCompact(event.overflow === true ? 'overflow' : 'done')
        return
      case 'waiting-reason':
        this.waitingReason = event.reason
        this.waitingReasonAt = event.at
        return
      case 'waiting-cleared':
        this.clearWaitingReason()
        return
      case 'agent-status':
        this.onAgentStatus(event.status)
        return
      default:
        return
    }
  }

  /**
   * Feed one raw durable session event.
   * @deprecated Host-shape input kept for one release so an already-published
   * consumer that drives this tracker itself (dsh-TUI ≤ 0.11.x calls this
   * method) keeps working across the upgrade. New code normalizes through
   * `src/compat/*` and calls {@link onEvent}. The parameter type is inferred
   * from the compat function on purpose — this module must not import a DSH
   * type.
   * @param event - Raw durable session event.
   */
  onSessionEvent(event: Parameters<typeof feedSessionEvent>[1]): void {
    feedSessionEvent(this, event)
  }

  /** Render the current status snapshot at a wall-clock instant. */
  render(nowMs: number = this.now()): ActivityState {
    switch (this.phase) {
      case 'idle':
        return {
          phase: 'idle',
          line: '',
          toolCount: 0,
          turnElapsedMs: 0,
          phaseStartedAt: this.phaseStartedAt,
        }
      case 'done': {
        const summary = this.doneSummary(nowMs)
        return {
          phase: 'done',
          line: summary.line,
          toolCount: this.toolCount,
          turnElapsedMs: this.turnElapsedMs(nowMs),
          phaseStartedAt: this.phaseStartedAt,
          ...(summary.phrase === undefined ? {} : { phrase: summary.phrase }),
        }
      }
      case 'tool': {
        const tool = this.primaryTool()
        if (tool === undefined) {
          return this.renderThinking(nowMs)
        }
        const fragment = toolFragment(tool)
        // Same granularity as the settled line: a fast tool's counter would
        // otherwise sit at `0s` for its whole (measured 87 ms median) life.
        const elapsed = durationLabel(Math.max(0, nowMs - tool.startedAt))
        const git = tool.isGit
          ? (this.gitBranch !== undefined ? ` · git ${this.gitBranch}` : ' · git')
          : ''
        const combo = (this.config.features ?? {}).combo !== false && this.streak >= COMBO_SHOW_AT
          ? ` · ${t('tool-streak', { count: this.streak })}`
          : ''
        // An approval-parked tool says so even in minimal mode: this is the one
        // state where the user, not the model, is the one being waited on.
        const approval = this.waitingReason === 'approval' ? ` · ${t('tool-waiting-approval')}` : ''
        const narration = this.freshNarration(nowMs)
        // The turn's first tool opens with a short "thought it through, getting
        // to work" line, prepended so the tool's own copy stays readable.
        const opening = this.toolOpening(nowMs)
        const prefix = opening === '' ? '' : `${opening} · `
        const line = narration === null
          ? `${prefix}${fragment} · ${elapsed}${git}${combo}${approval}`
          : `⏵ ${narration} · ${prefix}${fragment} · ${elapsed}${git}${combo}${approval}`
        return {
          phase: 'tool',
          line,
          label: tool.action,
          detail: tool.detail,
          ...(narration === null ? (opening === '' ? {} : { phrase: opening }) : { phrase: narration }),
          toolCount: this.toolCount,
          turnElapsedMs: this.turnElapsedMs(nowMs),
          phaseStartedAt: this.phaseStartedAt,
        }
      }
      case 'waiting':
      case 'thinking': {
        const rendered = this.renderThinking(nowMs)
        if (this.phase === 'waiting') {
          return { ...rendered, phase: 'waiting' }
        }
        return rendered
      }
    }
  }

  /** Per-turn thinking/tooling split for stats consumers. */
  stats(): TurnStats {
    return {
      thinkingMs: this.thinkingMs,
      toolMs: this.toolMs,
      toolCount: this.toolCount,
    }
  }

  /**
   * Opaque, JSON-safe snapshot of this tracker's complete state.
   *
   * A persisted projection checkpoint has to resume folding **without**
   * replaying a session's whole log, so the state machine must be able to hand
   * its state out and take it back. The shape is not public API: pass the value
   * straight back to {@link ActivityTracker.restore}. {@link TRACKER_SNAPSHOT_VERSION}
   * is the compatibility handle between the two.
   * @returns every field the fold depends on, as JSON-safe values.
   */
  snapshot(): unknown {
    const data: TrackerSnapshotShape = {
      version: TRACKER_SNAPSHOT_VERSION,
      phase: this.phase,
      phaseStartedAt: this.phaseStartedAt,
      turnStartedAt: this.turnStartedAt,
      thinkingStartedAt: this.thinkingStartedAt,
      thinkingMs: this.thinkingMs,
      toolMs: this.toolMs,
      toolCount: this.toolCount,
      activeTools: [...this.activeTools.values()],
      doneQueue: this.doneQueue,
      thinkingPhases: this.thinkingPhases,
      firstToolStartedAt: this.firstToolStartedAt,
      waitingFirstToken: this.waitingFirstToken,
      firstTokenAt: this.firstTokenAt,
      narratedText: this.narratedText,
      lastChunkAt: this.lastChunkAt,
      recentStream: this.recentStream,
      turnTokens: this.turnTokens,
      donePrefix: this.donePrefix,
      pendingPhrase: this.pendingPhrase,
      pendingUntil: this.pendingUntil,
      gitBranch: this.gitBranch ?? null,
      model: this.model ?? null,
      streak: this.streak,
      lastToolEndAt: this.lastToolEndAt,
      maxStreak: this.maxStreak,
      subagentCount: this.subagentCount,
      waitingReason: this.waitingReason ?? null,
      waitingReasonAt: this.waitingReasonAt,
      tokBuf: this.tokBuf,
      tokWindowStart: this.tokWindowStart,
    }
    return data
  }

  /**
   * Rebuild a tracker from {@link snapshot} output.
   *
   * The behavioral knobs are not part of the snapshot, so they are passed in
   * again; everything the fold accumulates is restored. Mutable entries are
   * cloned, so the restored tracker can never write back into the value the
   * caller still holds as a checkpoint.
   * @param config - Behavioral knobs.
   * @param now - Wall-clock supplier.
   * @param customActions - Custom action pools.
   * @param payload - A value previously returned by `snapshot()`.
   * @returns an equivalent tracker that can keep folding.
   * @throws when the payload is not a snapshot of {@link TRACKER_SNAPSHOT_VERSION}
   * — a caller holding a stale checkpoint must refold the log rather than render
   * a state it cannot interpret.
   */
  static restore(
    config: TrackerConfig,
    now: () => number = Date.now,
    customActions?: Readonly<Record<string, readonly string[]>>,
    payload?: unknown,
  ): ActivityTracker {
    const data = payload as TrackerSnapshotShape | undefined
    // The shape guards are deliberately cheap (phase + the two anchor clocks):
    // they catch the torn-write / hand-edited cache cases a version number
    // alone cannot, so a corrupt-but-current-version checkpoint fails HERE —
    // where the projection can catch it and refold — instead of mid-render.
    if (data === undefined || data === null || typeof data !== 'object'
      || data.version !== TRACKER_SNAPSHOT_VERSION
      || !isPhase(data.phase)
      || typeof data.phaseStartedAt !== 'number'
      || typeof data.turnStartedAt !== 'number') {
      throw new Error(
        `working-activity: unsupported tracker snapshot (expected version ${TRACKER_SNAPSHOT_VERSION})`,
      )
    }
    const tracker = new ActivityTracker(config, now, customActions)
    tracker.phase = data.phase
    tracker.phaseStartedAt = data.phaseStartedAt
    tracker.turnStartedAt = data.turnStartedAt
    tracker.thinkingStartedAt = data.thinkingStartedAt
    tracker.thinkingMs = data.thinkingMs
    tracker.toolMs = data.toolMs
    tracker.toolCount = data.toolCount
    tracker.activeTools = new Map(data.activeTools.map(tool => [tool.callId, { ...tool }]))
    tracker.doneQueue = data.doneQueue.map(tool => ({ ...tool }))
    tracker.thinkingPhases = data.thinkingPhases
    tracker.firstToolStartedAt = data.firstToolStartedAt
    tracker.waitingFirstToken = data.waitingFirstToken
    tracker.firstTokenAt = data.firstTokenAt
    tracker.narratedText = data.narratedText
    tracker.lastChunkAt = data.lastChunkAt
    tracker.recentStream = data.recentStream
    tracker.turnTokens = data.turnTokens
    tracker.donePrefix = data.donePrefix
    tracker.pendingPhrase = data.pendingPhrase
    tracker.pendingUntil = data.pendingUntil
    tracker.gitBranch = data.gitBranch ?? undefined
    tracker.model = data.model ?? undefined
    tracker.streak = data.streak
    tracker.lastToolEndAt = data.lastToolEndAt
    tracker.maxStreak = data.maxStreak
    tracker.subagentCount = data.subagentCount
    tracker.waitingReason = data.waitingReason ?? undefined
    tracker.waitingReasonAt = data.waitingReasonAt
    tracker.tokBuf = data.tokBuf
    tracker.tokWindowStart = data.tokWindowStart
    return tracker
  }

  /**
   * The next instant at which {@link render} can produce a different line, or
   * `undefined` when the line stays exactly as it is until another event
   * arrives.
   *
   * A status line does not need a heartbeat: it needs to be redrawn when
   * something it displays moves. Those movements are all known here — the
   * elapsed second, the phrase rotation, a narration or tok/s window closing,
   * and the done card swapping its tool fragment for the summary — so a caller
   * can sleep exactly that long instead of polling. Idle and settled lines
   * return `undefined`: nothing about them changes on its own, so they need no
   * timer at all. Transitions on a longer horizon than the displayed second
   * (the work reminder, for one) need no candidate of their own: the elapsed
   * counter redraws long before them.
   *
   * The value is a lower bound on the next visible change, so waking at it can
   * only be early, never late.
   * @param nowMs - Wall-clock instant to measure from.
   * @returns the next wake instant in epoch milliseconds, or `undefined`.
   */
  nextWakeAt(nowMs: number = this.now()): number | undefined {
    switch (this.phase) {
      case 'idle':
        return undefined
      case 'done': {
        // The done line shows the last tool's fragment for a short window and
        // then the summary; after that it is static until the next turn.
        const last = this.doneQueue.at(-1)
        if (last === undefined) return undefined
        const swapAt = last.endedAt + DONE_FRAGMENT_MS
        return nowMs < swapAt ? swapAt : undefined
      }
      case 'tool': {
        const tool = this.primaryTool()
        // `render` falls back to the thinking line when no tool is tracked.
        if (tool === undefined) return this.liveWakeAt(nowMs, this.thinkingStartedAt)
        return minWake(
          secondBoundary(tool.startedAt, nowMs),
          this.narrationWakeAt(nowMs),
          this.tpsWakeAt(nowMs),
        )
      }
      case 'waiting':
      case 'thinking':
        return this.liveWakeAt(nowMs, this.turnStartedAt)
    }
  }

  /**
   * Wake instant for a live phase that displays the turn's elapsed second: the
   * next whole second, whichever of the other displayed windows closes first,
   * and the phrase rotation — or the expiry of a one-off quip, which the render
   * after it replaces.
   * @param nowMs - Wall-clock instant to measure from.
   * @param elapsedFrom - Instant the displayed second counter counts from.
   */
  private liveWakeAt(nowMs: number, elapsedFrom: number): number | undefined {
    return minWake(
      secondBoundary(elapsedFrom, nowMs),
      this.rotationWakeAt(nowMs),
      this.narrationWakeAt(nowMs),
      this.tpsWakeAt(nowMs),
    )
  }

  /** When the displayed phrase is replaced: a rotation, or a quip expiring. */
  private rotationWakeAt(nowMs: number): number | undefined {
    if (!this.config.phrases) return undefined
    // An expired quip is no longer displayed (see pendingPhraseAt), so the
    // wake falls through to the pool rotation — returning its past expiry
    // would arm a zero-delay timer that re-arms forever.
    if (this.pendingPhrase !== null && nowMs < this.pendingUntil) return this.pendingUntil
    // The next window boundary of the phase's own pool. Derived rather than
    // remembered: a read must never be what advances the copy (see phraseForSlot).
    const rotateMs = this.rarePool() ? RARE_ROTATE_MS : PHRASE_ROTATE_MS
    return this.phraseAnchorAt() + (this.phraseSlot(nowMs, rotateMs) + 1) * rotateMs
  }

  /** When the currently displayed narration expires, if one is displayed. */
  private narrationWakeAt(nowMs: number): number | undefined {
    if (this.freshNarration(nowMs) === null) return undefined
    return this.lastChunkAt + NARRATE_GRACE_MS
  }

  /** When the displayed tok/s estimate ages out, if one is displayed. */
  private tpsWakeAt(nowMs: number): number | undefined {
    if (this.config.showTokPerSec !== true || this.tokBuf <= 0) return undefined
    if (this.tpsPrefix(nowMs) === '') return undefined
    return this.lastChunkAt + TPS_WINDOW_MS
  }

  private renderThinking(nowMs: number): ActivityState {
    const thinkingMs = this.phase === 'waiting'
      ? 0
      : this.thinkingMs + Math.max(0, nowMs - this.thinkingStartedAt)
    const elapsed = fmtDuration(this.turnElapsedMs(nowMs))
    const elapsedLine = t('line-elapsed', { elapsed })
    // A tool that just settled keeps its own copy on screen for a beat. Measured
    // on real sessions: the median tool lasts 87 ms and 73% last under 500 ms, so
    // without this the tool line is a single frame nobody can read. It outranks
    // the narration for its window — the narration is usually the same `⏵` line
    // from before the tool, while this one is the news.
    const settled = this.settledToolLine(nowMs)
    if (settled !== null) return settled
    const narration = this.freshNarration(nowMs)
    if (narration !== null) {
      return {
        phase: this.phase,
        line: `⏵ ${narration} · ${elapsedLine}`,
        phrase: narration,
        toolCount: this.toolCount,
        turnElapsedMs: this.turnElapsedMs(nowMs),
        phaseStartedAt: this.phaseStartedAt,
      }
    }
    // A stall outranks the copy pools (and survives minimal mode): the pool
    // says "still queuing", which reads as model latency — a retry or a parked
    // approval is a different fact the user cannot act on unless it is said.
    const stall = this.stallPhrase()
    if (stall !== null) {
      return {
        phase: this.phase,
        line: `${stall} · ${elapsedLine}`,
        phrase: stall,
        toolCount: this.toolCount,
        turnElapsedMs: this.turnElapsedMs(nowMs),
        phaseStartedAt: this.phaseStartedAt,
      }
    }
    if (this.config.phrases) {
      const pending = this.pendingPhraseAt(nowMs)
      // Waiting (pre-first-token) draws from the waiting pool; thinking draws
      // the egg-aware lively pool (holiday / rare / weekend / night). The pool
      // follows the CURRENT phase and the window follows the phase's own start,
      // so neither the copy nor the cadence depends on how often this is read.
      const rotateMs = this.rarePool() ? RARE_ROTATE_MS : PHRASE_ROTATE_MS
      const phrase = pending ?? this.phraseForSlot(this.phraseSlot(nowMs, rotateMs), rotateMs, nowMs)
      // The indicator animation (whale etc.) already signals activity, so the
      // pi DOT_FRAMES ellipsis breathing is dropped for the DSH line.
      const tps = this.tpsPrefix(nowMs)
      return {
        phase: this.phase,
        line: `${tps}${phrase} · ${elapsedLine}`,
        phrase,
        toolCount: this.toolCount,
        turnElapsedMs: this.turnElapsedMs(nowMs),
        phaseStartedAt: this.phaseStartedAt,
      }
    }
    const label = this.phase === 'waiting' ? t('waiting-label') : t('thinking-label')
    return {
      phase: this.phase,
      line: `${label} · ${elapsedLine}`,
      label,
      toolCount: this.toolCount,
      turnElapsedMs: this.turnElapsedMs(nowMs),
      phaseStartedAt: this.phaseStartedAt,
    }
  }

  /**
   * The live facts a projection cannot fold, when any.
   *
   * A projection folds DURABLE events only, but two things the line displays
   * are born on live stream frames: the `⏵` narration, and — the one this
   * exists for — **that the first token already arrived**. Without the latter
   * a projected line sits in the waiting pool for the entire generation (the
   * frames never fold on the current host line), telling the user "still
   * queuing" while the model has been writing for a minute. A live host hands
   * both over per read (see `ActivityProjectionOptions.live`).
   */
  liveState(): {
    readonly narration?: string
    readonly lastChunkAt?: number
    readonly firstTokenAt?: number
  } {
    const overlay: { narration?: string; lastChunkAt?: number; firstTokenAt?: number } = {}
    if (this.narratedText !== null) {
      overlay.narration = this.narratedText
      overlay.lastChunkAt = this.lastChunkAt
    }
    if (this.firstTokenAt > 0) overlay.firstTokenAt = this.firstTokenAt
    return Object.keys(overlay).length > 0 ? overlay : {}
  }

  /**
   * The live narration this tracker is currently showing, if any.
   *
   * Narrow view of {@link liveState} for callers that only narrate.
   */
  liveNarration(): { readonly narration: string; readonly lastChunkAt: number } | undefined {
    if (this.narratedText === null) return undefined
    return { narration: this.narratedText, lastChunkAt: this.lastChunkAt }
  }

  /**
   * Apply the live host's facts to a (restored) projected copy.
   *
   * The state itself never changes — the overlay paints a throwaway render:
   * the narration when the host has one, and the first-token promotion when
   * the host has seen output the fold could not see.
   * @param live - What the live host knows (any subset).
   */
  applyLiveState(live: {
    narration?: string
    lastChunkAt?: number
    firstTokenAt?: number
  }): void {
    if (live.narration !== undefined && live.lastChunkAt !== undefined) {
      this.narratedText = live.narration
      this.lastChunkAt = live.lastChunkAt
    }
    if (live.firstTokenAt !== undefined) this.promoteFirstToken(live.firstTokenAt)
  }

  /**
   * Show `narration` as if it had just streamed in.
   *
   * Used by the live overlay: the projected state carries no frames, so the
   * host paints the freshest narration it has over the folded value.
   */
  applyLiveNarration(narration: string, at: number): void {
    this.applyLiveState({ narration, lastChunkAt: at })
  }

  /**
   * The first streamed token arrived at `at` — leave the waiting pool.
   *
   * Idempotent (a second call does nothing), and a delta that arrives while a
   * tool runs must not steal the phase: models may stream text after a tool
   * call inside the same attempt, and the tool is what the user is actually
   * waiting on — the tool result hands the phase back to thinking on its own.
   */
  private promoteFirstToken(at: number): void {
    if (!this.waitingFirstToken) return
    this.waitingFirstToken = false
    this.firstTokenAt = at
    if (this.activeTools.size === 0) {
      this.setPhase('thinking', at)
      this.thinkingStartedAt = at
    }
  }

  /**
   * The "thought it through, getting to work" line for the turn's first tool.
   *
   * Shown as a prefix for a short window after that tool starts, then gone: it
   * marks the thinking→doing boundary once per turn, and being derived (like
   * every other phrase) it neither rotates nor repeats within the window.
   * @param nowMs - Wall-clock instant to test.
   * @returns the opening copy, or '' when the window is closed.
   */
  private toolOpening(nowMs: number): string {
    if (!this.config.phrases) return ''
    if (this.firstToolStartedAt === 0) return ''
    if (nowMs - this.firstToolStartedAt >= TOOL_OPENING_MS) return ''
    return toolOpeningPhrase({ seed: this.turnStartedAt, slot: 0 })
  }

  /**
   * The just-finished tool, while its copy is still worth reading.
   *
   * Derived from the last settled tool's end time, so it neither lingers past
   * its window nor depends on how often the line is read. `✓` marks it as
   * settled, so it cannot be mistaken for the running-tool line.
   * @param nowMs - Wall-clock instant to test.
   * @returns the settled-tool state, or null when the window is closed.
   */
  private settledToolLine(nowMs: number): ActivityState | null {
    if (!this.config.phrases) return null
    const last = this.doneQueue.at(-1)
    if (last === undefined) return null
    const age = nowMs - last.endedAt
    if (age < 0 || age >= TOOL_LINGER_MS) return null
    const fragment = toolFragment(last)
    return {
      phase: this.phase === 'waiting' ? 'thinking' : this.phase,
      line: `✓ ${fragment} · ${durationLabel(last.durationMs)}`,
      label: last.action,
      detail: last.detail,
      phrase: last.action,
      toolCount: this.toolCount,
      turnElapsedMs: this.turnElapsedMs(nowMs),
      phaseStartedAt: this.phaseStartedAt,
    }
  }

  /**
   * The pending one-off quip (interrupt / model / compact), while fresh.
   *
   * A pure read: an expired quip is simply not returned (the field is
   * overwritten by the next one), and the work reminder has its own derived
   * window — the old version wrote here (`pendingPhrase = null`,
   * `reminded = true`), which a projection's throwaway restore discarded, so
   * the reminder re-fired on EVERY read and pinned the line for the rest of
   * the turn.
   */
  private pendingPhraseAt(nowMs: number): string | null {
    if (this.pendingPhrase !== null && nowMs < this.pendingUntil) return this.pendingPhrase
    return this.workReminderAt(nowMs)
  }

  /**
   * The work reminder, purely derived from elapsed time.
   *
   * Shown for {@link PENDING_MS} of wall time each time another `workRemindAt`
   * hours of continuous work accumulate (`hours % workRemindAt` is the distance
   * into the current bucket). No state: repeated reads agree, a resumed
   * checkpoint renders the same answer, and the reminder returns every bucket
   * instead of once per process.
   */
  private workReminderAt(nowMs: number): string | null {
    const remindAt = this.config.workRemindAt ?? 0
    if (remindAt <= 0) return null
    const hours = this.turnElapsedMs(nowMs) / 3_600_000
    if (hours < remindAt) return null
    const intoBucketMs = (hours % remindAt) * 3_600_000
    if (intoBucketMs >= PENDING_MS) return null
    return t('work-remind', { hours: Math.floor(hours) })
  }

  /** Estimated tokens/s while the stream is fresh (pi parity, opt-in). */
  private tpsPrefix(nowMs: number): string {
    if (!this.config.showTokPerSec || this.tokBuf <= 0) return ''
    if (nowMs - this.lastChunkAt > TPS_WINDOW_MS) return ''
    const windowSec = Math.max(1, (nowMs - this.tokWindowStart) / 1000)
    const tps = Math.round(this.tokBuf / windowSec)
    return tps > 0 ? `~${tps} tok/s · ` : ''
  }

  private doneSummary(nowMs: number): { line: string; phrase?: string } {
    const { thinkingMs, toolMs, toolCount } = this.stats()
    const tokens = this.turnTokens > 0 ? ` · 🔥 ${fmtTokens(this.turnTokens)}` : ''
    const sub = this.subagentCount > 0 ? ` · ${t('subagent-count', { count: this.subagentCount })}` : ''
    const combo = (this.config.features ?? {}).combo !== false && this.maxStreak >= COMBO_SHOW_AT
      ? ` · ${t('tool-streak', { count: this.maxStreak })}`
      : ''
    const tools = t(toolCount === 1 ? 'tool-count-one' : 'tool-count-many', { count: toolCount })
    // Sub-second splits read in milliseconds for the same reason a settled
    // tool does: a quick turn would otherwise summarize as 想0s 干0s.
    const summary = t('done-summary', {
      tools,
      thinking: durationLabel(thinkingMs),
      tooling: durationLabel(toolMs),
    })
    if (!this.config.phrases) {
      return { line: `${t('done-prefix')} · ${summary}${sub}${combo}${tokens}` }
    }
    const last = this.doneQueue.at(-1)
    if (last !== undefined && nowMs - last.endedAt < DONE_FRAGMENT_MS) {
      const fragment = toolFragment(last)
      return { line: `${this.donePrefix} · ${fragment} · ${tools}${sub}${combo}${tokens}`, phrase: this.donePrefix }
    }
    return { line: `${this.donePrefix} · ${summary}${sub}${combo}${tokens}`, phrase: this.donePrefix }
  }

  /** The fresh self-narration line, or null once the stream has been quiet. */
  private freshNarration(nowMs: number): string | null {
    if (this.narratedText === null) return null
    if (nowMs - this.lastChunkAt > NARRATE_GRACE_MS) return null
    return this.narratedText
  }

  private primaryTool(): ActiveTool | undefined {
    let primary: ActiveTool | undefined
    for (const tool of this.activeTools.values()) {
      if (primary === undefined || tool.startedAt < primary.startedAt) primary = tool
    }
    return primary
  }

  private turnElapsedMs(nowMs: number): number {
    return this.turnStartedAt === 0 ? 0 : Math.max(0, nowMs - this.turnStartedAt)
  }

  /** Drop the current stall, whatever it was. */
  private clearWaitingReason(): void {
    this.waitingReason = undefined
    this.waitingReasonAt = 0
  }

  /**
   * Copy for the current stall, or null when the turn is not stalled.
   *
   * Deterministic per stall — seeded by the turn and the stall's start, so
   * every read of one stall shows the same line (a per-read re-roll is the
   * flicker bug the slot scheme exists to prevent).
   */
  private stallPhrase(): string | null {
    if (this.waitingReason === undefined) return null
    return waitingReasonPhrase(this.waitingReason, {
      seed: this.turnStartedAt + this.waitingReasonAt,
      slot: 0,
    })
  }

  /**
   * How the current line is derived — the debug trace behind the optional
   * `debugLog`, so "why did it say THAT" is answerable from a file instead of
   * from memory.
   * @param nowMs - Wall-clock instant to describe.
   * @returns the derivation inputs of the current render.
   */
  describe(nowMs: number = this.now()): Record<string, unknown> {
    const rotateMs = this.rarePool() ? RARE_ROTATE_MS : PHRASE_ROTATE_MS
    return {
      phase: this.phase,
      phraseSlot: this.phraseSlot(nowMs, rotateMs),
      rotateMs,
      rarePool: this.rarePool(),
      thinkingPhases: this.thinkingPhases,
      waitingReason: this.waitingReason ?? null,
      pendingPhrase: this.pendingPhrase ?? null,
      narration: this.narratedText ?? null,
      toolCount: this.toolCount,
      turnElapsedMs: this.turnElapsedMs(nowMs),
    }
  }

  private setPhase(phase: ActivityPhase, atMs: number): void {
    // A phase change switches copy pools at once — the phrase is derived from
    // the CURRENT phase, so nothing from the previous phase can linger.
    if (phase === 'thinking' && this.phase !== 'thinking') this.thinkingPhases += 1
    this.phase = phase
    this.phaseStartedAt = atMs
  }

  /**
   * The instant the current phrase's rotation window starts from.
   *
   * The phase's own start, so entering a phase immediately shows that phase's
   * copy; a phase still needs a turn to belong to, hence the fallback.
   */
  private phraseAnchorAt(): number {
    return this.phaseStartedAt > 0 ? this.phaseStartedAt : this.turnStartedAt
  }

  /** The rotation window index of the current phase at `nowMs`. */
  private phraseSlot(nowMs: number, rotateMs: number): number {
    return Math.max(0, Math.floor((nowMs - this.phraseAnchorAt()) / rotateMs))
  }

  /**
   * Whether this phase draws from the rare pool.
   *
   * Once per turn, in the turn's FIRST thinking phase, decided by the seed — a
   * per-read dice roll would pop an egg in and out of the line (the egg's own
   * display window then lasts for the whole phase).
   */
  private rarePool(): boolean {
    const features = this.config.features ?? {}
    if (features.rareEggs === false) return false
    if (this.phase !== 'thinking' || this.thinkingPhases !== 1) return false
    return mixSlot(this.turnStartedAt, 0x5EED) % Math.round(1 / RARE_CHANCE) === 0
  }

  /**
   * The phrase for one rotation window — a PURE function of the state and `nowMs`.
   *
   * This used to be stateful (`previousPhrase` + `phraseChangedAt` mutated on
   * render). That works for a long-lived in-process tracker, but a projected
   * value is read far more often than it is written: the read renders a
   * throwaway copy, so every read rolled a new phrase (measured: three different
   * phrases in three consecutive 500 ms reads) and a phase change could carry the
   * previous phase's pool in. Deriving from (phase, phase start, seed, slot)
   * makes a read idempotent and keeps the pools apart by construction.
   */
  private phraseForSlot(slot: number, rotateMs: number, nowMs: number): string {
    const at: PhraseSlot = { seed: this.turnStartedAt, slot }
    const features = this.config.features ?? {}
    // The RENDER instant, not the tracker's clock supplier: one render, one
    // time source. Night/holiday copy used to read `this.now()` while the
    // elapsed read `nowMs`, so rendering "as of" another instant (a test, a
    // historical value) picked copy from a different moment than it displayed.
    const now = new Date(nowMs)
    if (this.phase === 'waiting') return waitingPhrase(undefined, at)
    // Eggs belong to the turn's first thinking window — the waiting phase is
    // usually over before a window elapses, so a greeting shown there would
    // flash by. Order matches the pi extension: holiday → rare → weekend, and
    // "first thinking phase, first window" is what makes them once per turn.
    if (this.thinkingPhases === 1 && slot === 0) {
      if (features.holidays !== false) {
        const holiday = holidayPhrase(now, at)
        if (holiday !== null) return holiday
      }
      if (this.rarePool()) return rarePhrase(undefined, at)
      if (features.weekend !== false && isWeekend(now)) return weekendPhrase(undefined, at)
    }
    if (this.rarePool()) return rarePhrase(undefined, at)
    // The long-thinking tiers are chosen at the WINDOW's start, not at the
    // instant of the read: a tier boundary crossed mid-window would otherwise
    // swap the copy seconds into a window the reader is still on.
    const windowStart = this.phraseAnchorAt() + slot * rotateMs
    const thinkingAtWindowStart = Math.max(0, windowStart - this.thinkingStartedAt)
    return thinkingPhrase(
      this.thinkingStartedAt === 0 ? this.thinkingMs : thinkingAtWindowStart,
      undefined,
      features.nightPhrases !== false && isNight(now.getHours()),
      this.config.customPhrases,
      at,
    )
  }
}

/** Earliest of the candidate wake instants, ignoring the absent ones. */
function minWake(...candidates: readonly (number | undefined)[]): number | undefined {
  let earliest: number | undefined
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    if (earliest === undefined || candidate < earliest) earliest = candidate
  }
  return earliest
}

/**
 * The next whole second after `nowMs`, counted from `from`. The line renders
 * elapsed time with second resolution, so this is the finest cadence a live
 * phase can actually show.
 * @param from - Instant the displayed counter counts from.
 * @param nowMs - Current instant.
 */
function secondBoundary(from: number, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - from)
  return from + (Math.floor(elapsed / 1000) + 1) * 1000
}

/**
 * How long one phrase stays on screen.
 *
 * This is the pi extension's cadence, unchanged: the copy was never rotating
 * too fast — it was being re-rolled on every read (see phraseForSlot), which is
 * what read as flicker. With the read made pure, one phrase per window is
 * exactly what a reader sees, and 4 s is the pace that felt right.
 */
const PHRASE_ROTATE_MS = 4000
/** Rare easter-egg phrases linger longer, since they are a one-off per turn. */
const RARE_ROTATE_MS = 7500
/** One-off quips (interrupt / model / compact) display window. */
const PENDING_MS = 6000
/** How long the thinking→doing opening line rides the turn's first tool. */
const TOOL_OPENING_MS = 2500
/**
 * How long a settled tool keeps its own line before the copy returns to phrases.
 *
 * Real-session measurement: median tool 87 ms, 73% under 500 ms — shorter than a
 * single client re-read, so without a linger the tool line is unreadable.
 */
const TOOL_LINGER_MS = 2500
/** Tools closer than this count as one combo streak. */
const COMBO_GAP_MS = 10_000
/** Streak at which the combo badge shows. */
const COMBO_SHOW_AT = 2
/** The tps estimate stays fresh this long after the last chunk. */
const TPS_WINDOW_MS = 3500
/** Cap on replayed done cards; older entries drop. */
const DONE_QUEUE_MAX = 6
/** Show the last tool's fragment in the done line for this long after it ends. */
const DONE_FRAGMENT_MS = 3000
/** Rolling stream buffer size for `⏵` narration extraction. */
const STREAM_BUFFER_CHARS = 300
/** A narration stays visible this long after the stream went quiet. */
const NARRATE_GRACE_MS = 5000

/** Narration budget in display columns: 40 CJK chars ≈ 12 English words. */
const NARRATION_MAX_COLUMNS = 80

/** A CJK/full-width code point renders 2 terminal columns; the rest render 1. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals, kana, Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // full-width forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // full-width signs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK extensions
    // Emoji occupy two columns in every mainstream terminal; counting them as
    // one let an "80-column" narration run ~40 columns over budget (the pools
    // carry 🧧 🐳 🎃).
    || (cp >= 0x1f000 && cp <= 0x1faff) // cards, emoji, symbols, pictographs
  )
}

/** Cut before `max` columns, backing off to the last word or clause boundary. */
function cutToWidth(text: string, max: number): string {
  let width = 0
  let cut = text.length
  const chars = [...text]
  for (let i = 0; i < chars.length; i++) {
    const w = isWide(chars[i]!.codePointAt(0)!) ? 2 : 1
    if (width + w > max) {
      cut = chars.slice(0, i).join('').length
      break
    }
    width += w
  }
  if (cut === text.length) return text
  // Back off to a soft boundary so English words survive intact; dense CJK has
  // none and hard-cuts at the budget like the original fixed 40-char capture.
  const head = text.slice(0, cut)
  const soft = Math.max(
    head.lastIndexOf(' '),
    head.lastIndexOf('\t'),
    head.lastIndexOf('，'),
    head.lastIndexOf('、'),
    head.lastIndexOf(';'),
    head.lastIndexOf('；'),
    head.lastIndexOf(','),
  )
  return soft > 0 ? head.slice(0, soft) : head
}

/**
 * Extract the latest `⏵` self-narration line from a stream buffer.
 *
 * The marker has to START a line. The injected contract asks for one standalone
 * line, so a `⏵` inside a sentence is the model *mentioning* the format rather
 * than narrating with it — measured on a live session, where the line quoted a
 * fragment out of the middle of the model's own prose.
 *
 * The text is model output destined for a terminal, so it is flattened here:
 * an ESC or a newline carried by a delta must not reach the screen (see
 * {@link sanitizeFragment}).
 * @param buffer - Rolling window of the visible streamed text.
 * @returns the narration, or null when the buffer carries none.
 */
export function extractNarration(buffer: string): string | null {
  const matches = [...buffer.matchAll(/(?:^|\n)⏵[ \t]*([^\n⏵]*)/g)]
  const matched = matches[matches.length - 1]?.[1]
  if (matched === undefined) return null
  const latest = sanitizeFragment(matched)
  if (!latest) return null

  // A missing newline must not turn the rest of the response into status text.
  // Stop at sentence ends and clause delimiters, while leaving dotted
  // identifiers such as `ink.tsx`, `agent.ctx` and `README.MD` intact. A dot
  // ends a sentence only before whitespace, the end, or a Title-case word
  // (`safely.The`); dot-uppercase-uppercase stays an extension (`.MD`).
  const boundary = latest.search(/[。．!?！？;；]|\.(?=\s|$|[A-Z][a-z])/)
  const sentence = boundary < 0 ? latest : latest.slice(0, boundary + 1)

  // The budget is display width, so English and Chinese render equally long:
  // 40 CJK characters and ~12 English words share the same line budget.
  const text = cutToWidth(sentence, NARRATION_MAX_COLUMNS).replace(/[。．.!！,，、;；]+$/, '').trim()
  return text.length === 0 ? null : text
}

/** Format a token count compactly (`12.3k`, `1.2M`). */
function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

/** Coarse streaming token estimate (pi parity: CJK ×1.5, others ÷4). */
function estimateTokens(text: string): number {
  const compact = text.replace(/\s/g, '')
  if (compact.length === 0) return 0
  const cjkCount = (compact.match(/[\u3400-\u9fff]/g) ?? []).length
  return Math.max(1, Math.ceil(cjkCount * 1.5 + (compact.length - cjkCount) / 4))
}

/** Parse a tool call's raw arguments JSON defensively. */
function parseArguments(raw: string): Readonly<Record<string, unknown>> | undefined {
  if (raw.trim().length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Readonly<Record<string, unknown>>
    }
    return undefined
  } catch {
    return undefined
  }
}
