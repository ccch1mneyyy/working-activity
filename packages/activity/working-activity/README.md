# dsh-working-activity

A live "working line" for DeepSeek Harness: the model's real-time activity — playful thinking copy, the tool actually running, elapsed time, and a turn-end summary — shown while the agent works.

## What it does

Folds the durable session stream (`turn/start`, `assistant/chunk`, `tool/call`, `tool/result`, `turn/end`) plus `agent/status` into one status line, refreshed on a render tick:

- **Thinking**: short colloquial copy rotates every few seconds (`嗯…让我捋捋`, `盘一下盘一下`, `大脑转起来了`, deadpan `lol` / `hm` / `ok`), tiered when thinking runs long (30s / 1min / 5min), night-owl copy mixed in between 00:00–06:00 local time.
- **Tool activity**: the running tool renders as `俏皮动词 + 参数细节 + 已耗时` (`跑个命令 npm test · 12s`); failed tools show `翻车了`-style copy in the done line.
- **Turn summary**: on `turn/end` the line becomes `搞定 ✓ · N 工具 · 想Xs 干Ys` (thinking/tool split), with the last tool's fragment pinned for a few seconds.
- **Minimal mode**: `phrases: false` renders plain functional labels (`思考中 · 总1m23s`, `bash npm test · 12s`).

Two optional sinks, both off by default only when their seam is absent:

1. **TUI prompt slot** — registers the `${activity}` template value on `ctx.tuiPrompt` when the TUI is composed. Add `${activity}` to `theme.leftPrompt` to see it next to `cwd`/`model`/`context`.
2. **Session events** — appends log-only `activity/status` events (never surface events: the model never sees them) for log-replaying UI consumers; replay ignores them. The Web client does not use them (see [Web usage](#web-usage)).

## Installation

The package is a self-mounting bundle: it declares `dsh.bundle.patch`
(`cordis.patch.yml`), so the official CLI both installs it and appends it to
the profile's bundle layer stack:

```sh
dsh plugin --profile <profile> add dsh-working-activity
```

At boot, app-boot applies the bundle's patch list over the profile root and
the package inserts its own `working-activity` row — no manual configuration
required. To tune a value, override the row's config by id in the profile's
user layer (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`) instead of
inserting a second same-id row:

```yaml
- id: working-activity
  config:
    publishIntervalMs: 500
```

Host and TUI integration supports the DSH `0.1.0-rc.6` and `0.1.1-rc` lines,
plus `0.1.2-alpha.2`. The optional Web client targets the current client cohort
(`0.1.7-rc.2`, session projection) and is not covered by alpha.2 compatibility.

## Optional invariant companion

`./invariant` ships an `@deepseek-ai/dsh-invariants` companion that checks this
package's own payload contract — an object `activity/status` snapshot, a phase
from the published vocabulary, a non-empty `line`, non-negative finite metrics,
string-or-absent `label`/`detail`/`phrase` — for snapshots already in loaded
sessions and for every one appended afterwards.

It is **opt-in**: this bundle's `cordis.patch.yml` inserts only the
`working-activity` row, the host mounts one row per companion, and the registry
alone installs no checks. Add both rows to the profile user layer
(`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- insert:
    - id: invariants
      name: '@deepseek-ai/dsh-invariants'
    - id: working-activity-invariant
      name: 'dsh-working-activity/invariant'
```

The `name` must resolve this package's `./invariant` export subpath; the `id`
follows the host's `<package>-invariant` naming (`session-invariant`,
`agent-invariant`). Skip the `invariants` row where the composition already
mounts the registry.

## TUI usage

Install the plugin into a profile that composes the official `dsh-tui`, then
add the `${activity}` slot to the left prompt template in the profile's user
layer (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: tui
  config:
    theme:
      leftPrompt: '${cwd}${git/worktree}${activity}${model}${token_meter/cache_hit_rate}${context}'
```

While a turn runs, the prompt line shows e.g. `dsh main 跑个命令 npm test · 12s deepseek-chat …`; while thinking, `嗯…让我捋捋 · 总1m23s`; after the turn, `搞定 ✓ · 4 工具 · 想12s 干11s` briefly. Without `${activity}` in the template, the plugin is inert in the TUI (the slot is unregistered values are omitted by the template renderer).

## Web usage

The Web half is one entry — `WorkingLine` on `conversation.input.dock` — rendered as a single dim row above the composer card (phase-colored marker, the host's line, the turn's tool count). It renders nothing before the first value and while the phase is `idle`.

**Transport: a session projection, not the session log.** The node half folds every committed session event into the `workingActivity` session projection, and the host ships the whole value (phase, `line`, tool count, timestamps) to clients through the projection store. The browser reads it with the session standard kit's `useProjection('workingActivity')`. What follows from that:

- **Nothing is appended to the session log** for the Web UI: no `publish: true` session is needed, and no log becomes unresumable on this package's account.
- **The runtime patch is obsolete.** Earlier releases required a patched `@deepseek-ai/dsh-client-runtime` that copied `activity/status` events onto `ConversationSnapshot.activity`. That package is frozen at `0.1.1-rc.2` and absent from the current (`0.1.7-rc.2`) host line; this package no longer declares it, and the `ConversationSnapshot.activity` declaration merge is gone. The projection is the only transport.
- **The elapsed counter refreshes on events.** `line` is painted exactly as the host rendered it at the last fold, so a running tool's `· 12s` can lag until the next committed event; client-side ticking is a known follow-up (the value carries `phaseStartedAt` / `turnStartedAt` for it).

The entry declares the client cohort it actually uses — in `peerDependencies` and in `dsh.client.inject`: `@deepseek-ai/dsh-client-ui-slots` (slot contract), `@deepseek-ai/dsh-client-ui-conversation` (the dock seat), `@deepseek-ai/dsh-client-ui-session` (the session standard kit supplying `useProjection`), `@deepseek-ai/dsh-client-ui-renderer` (the `slots` service it registers through), and `@deepseek-ai/dsh-session-projection` (the projection key's type table). Every one of them is an optional peer, so a profile without the Web composition is unaffected.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `phrases` | `boolean` | `true` | Playful copy pool; `false` renders plain functional labels |
| `publish` | `boolean` | `false` | Append `activity/status` session events for log-replaying UI consumers. Off by default: appended events currently make session logs unresumable (see note below). The Web client reads the session projection instead and needs none of this |
| `tickMs` | `number` | `500` | Status render tick interval (100–5000) |
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

> **Why `publish` is off by default:** `session.append()` cannot mark events ignorable, and the resume read path refuses any log containing unknown non-ignorable event types — so with `publish: true`, every session that rendered a status line fails to resume. Re-enable only for a log-replaying consumer on a harness that supports ignorable appends. The live TUI prompt line is unaffected.

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
- **Web elapsed text is event-driven**: the dock entry paints the host's `line` as folded, so a long tool's seconds can lag until the next committed event; client-side ticking against `phaseStartedAt` / `turnStartedAt` is deferred.
