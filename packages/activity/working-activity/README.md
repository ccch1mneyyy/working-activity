# @deepseek-ai/dsh-working-activity

A live "working line" for DeepSeek Harness: the model's real-time activity — playful thinking copy, the tool actually running, elapsed time, and a turn-end summary — shown while the agent works.

## What it does

Folds the durable session stream (`turn/start`, `assistant/chunk`, `tool/call`, `tool/result`, `turn/end`) plus `agent/status` into one status line, refreshed on a render tick:

- **Thinking**: short colloquial copy rotates every few seconds (`嗯…让我捋捋`, `盘一下盘一下`, `大脑转起来了`, deadpan `lol` / `hm` / `ok`), tiered when thinking runs long (30s / 1min / 5min), night-owl copy mixed in between 00:00–06:00 local time.
- **Tool activity**: the running tool renders as `俏皮动词 + 参数细节 + 已耗时` (`跑个命令 npm test · 12s`); failed tools show `翻车了`-style copy in the done line.
- **Turn summary**: on `turn/end` the line becomes `搞定 ✓ · N 工具 · 想Xs 干Ys` (thinking/tool split), with the last tool's fragment pinned for a few seconds.
- **Minimal mode**: `phrases: false` renders plain functional labels (`思考中 · 总1m23s`, `bash npm test · 12s`).

Two optional sinks, both off by default only when their seam is absent:

1. **TUI prompt slot** — registers the `${activity}` template value on `ctx.tuiPrompt` when the TUI is composed. Add `${activity}` to `theme.leftPrompt` to see it next to `cwd`/`model`/`context`.
2. **Session events** — appends log-only `activity/status` events (never surface events: the model never sees them) for Web and other UI consumers; replay ignores them.

## Installation

```yaml
# cordis.yml
plugins:
  - id: working-activity
    name: '@deepseek-ai/dsh-working-activity'
```

## TUI usage

Enable the plugin alongside `dsh-tui` and add the slot to the left prompt template:

```yaml
plugins:
  - id: tui
    name: '@deepseek-ai/dsh-tui'
    config:
      theme:
        leftPrompt: '${cwd}${git/worktree}${activity}${model}${token_meter/cache_hit_rate}${context}'
  - id: working-activity
    name: '@deepseek-ai/dsh-working-activity'
```

While a turn runs, the prompt line shows e.g. `dsh main 跑个命令 npm test · 12s deepseek-chat …`; while thinking, `嗯…让我捋捋 · 总1m23s`; after the turn, `搞定 ✓ · 4 工具 · 想12s 干11s` briefly. Without `${activity}` in the template, the plugin is inert in the TUI (the slot is unregistered values are omitted by the template renderer).

## Web usage

The Web client renders the live line two ways, both fed by the `activity/status` events:

- The turn-level status label (`TurnStatus`, formerly the static "Deep diving...") shows the live line while a turn runs, keeping its sweep animation.
- A working-line dock entry (`WorkingLine` on `conversation.input.dock`) renders the turn-end statistics (token/elapsed/tool summary) above the composer after a turn settles; live phases stay on the turn label.

Both fall back to the previous static label while the plugin is absent, so the Web UI is unaffected by disabling it.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `phrases` | `boolean` | `true` | Playful copy pool; `false` renders plain functional labels |
| `publish` | `boolean` | `true` | Append `activity/status` session events for UI consumers |
| `tickMs` | `number` | `500` | Status render tick interval (50–5000) |
| `publishIntervalMs` | `number` | `2000` | Minimum interval between published events while the line is stable (500–30000) |
| `detailLimit` | `number` | `40` | Max displayed detail length (paths/commands/patterns), 8–120 |
| `customActions` | `object` | `{}` | Exact tool-name → action-copy pools, e.g. `{"my_deploy": ["部署一下", "上线中"]}` |
| `narrate` | `boolean` | `true` | Inject the `⏵` self-narration contract into the system prompt; the line is surfaced live and stripped from the chat body |

## Event contract

`activity/status` is a log-only session event (merge-extensible `SessionEventMap` member, no `surfaceOp`):

```ts
{
  phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  line: string            // plain-text status line, no ANSI
  label?: string          // current work label (tool action / stage)
  detail?: string         // path / command / pattern fragment
  phrase?: string         // current playful phrase
  toolCount: number       // tools completed this turn
  turnElapsedMs: number   // ms since turn start
  phaseStartedAt: number  // epoch ms the phase started (animation anchor)
}
```

Publishing rules: line changes publish immediately; a stable line republishes at most every `publishIntervalMs` so a long tool's elapsed time stays live without flooding the log. All data is lossless JSON; optional fields are omitted when absent.

## Export shape

A function/namespace plugin: `name` / `Config` / `apply`, no default export. The state machine (`ActivityTracker`) and copy pools live in `./status` and `./phrases` (pure, clock-injected, unit-tested). The invariant companion registers under `./invariant`.

## Model Experience

### Prompt and tool surface

Nothing. The plugin injects no prompt sections, registers no tools, and appends no surface events. `activity/status` is UI state only: it never enters derived model history, so the model cannot see its own working line.

### Token effect

Zero per request.

### KV Cache effect

No system-prompt contribution, so no cache-stability effect.

## Known Limitations and Deferred Work

- **Single active line**: the plugin keeps one status line per session; the TUI slot shows the most recently active session.
- **Narration is opt-in**: the `⏵` self-narration contract (model writes a short status line at the top of each reply) is injected by default (`narrate: true`); set `narrate: false` for a purely event-derived line.
- **No progress percentages**: DSH has no tool progress events; a long tool shows elapsed time only.
- **No animated frames**: the TUI slot renders a static text fragment; frame animation (moon/comet/braille presets) is deferred until the prompt-slot contract supports a frame callback.
- **Web dock entry duplicates the turn label**: the input-dock `WorkingLine` and the chat `TurnStatus` show the same snapshot; the dock entry exists for session views where the turn label is not visible.
