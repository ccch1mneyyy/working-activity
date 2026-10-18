# dsh-working-activity

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-working-activity)](https://www.npmjs.com/package/dsh-working-activity)
[![CI](https://github.com/ccch1mneyyy/working-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/ccch1mneyyy/working-activity/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-working-activity)](LICENSE)
[![node](https://img.shields.io/node/v/dsh-working-activity)](package.json)

A live working-status line for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). While an agent works, the plugin folds the session's durable event stream and live model output into one line: the current phase copy, the tool that is actually running, elapsed time, and a turn-end summary.

The same line is rendered on every surface that composes the plugin: the terminal UI (`dsh-tui`), the browser Web UI, and the desktop GUI. The browser and desktop surfaces read a **session projection**; nothing is appended to the session log for them.

| | |
|---|---|
| Package | `dsh-working-activity` |
| Host | DSH `0.1.0-rc.6` through `0.2.1-rc.2` (see [Compatibility](#compatibility)) |
| Surfaces | TUI · Web UI · desktop GUI |
| Wire transport | Session projection `workingActivity`; optional ignorable `plugin:working-activity/status` records |
| Runtime | Node `^22.19 \|\| >=24` |
| License | BSD-3-Clause |

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
  - [TUI](#tui)
  - [Web UI](#web-ui)
  - [Desktop GUI](#desktop-gui)
- [Configuration](#configuration)
- [Projection contract](#projection-contract)
- [Session-record contract](#session-record-contract)
- [Compatibility](#compatibility)
- [Architecture](#architecture)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Privacy and security](#privacy-and-security)
- [License](#license)

## Features

- **Phase-aware status line.** The line moves through `waiting` → `thinking` → `tool` → `done`. Each phase has its own copy, its own rotation cadence, and its own elapsed formatting; settled phases carry a fixed summary rather than a counter.
- **Real tool activity.** A running tool is rendered as *verb + argument detail + elapsed* (`跑个命令 npm test · 12s`). Results are paired with calls by exact call id; failed tools get the failure copy and a `✗` marker.
- **Turn summary.** On `turn/end` the line becomes `搞定 ✓ · 4 工具 · 想12s 干11s` — tools completed, thinking time, and working time — and pins the last tool fragment briefly.
- **Compact HUD.** A short suffix folds the session's operational facts into the line: context pressure (`ctx 62%`, `⚠` at the warning threshold, `⛔` at danger), todo progress (`2/5 待办`), running background jobs, direct subagents or Agent Team members, durable goal rounds, plan mode, queued input, and the turn's token total at `done`. Every signal is feature-flagged; a host that does not publish one simply renders nothing.
- **Live self-narration.** With `narrate` on (the default), the plugin adds one short system-prompt contract asking the model to write a `⏵ …` line at the start of each step. The line is surfaced live in the status line while the durable message keeps it in the transcript.
- **Bilingual, feature-flagged copy.** Chinese and English pools, day/night variants, long-thinking tiers, weekend and holiday copy, rare eggs, tool combos, model-switch quips, and failure copy are each switchable. `phrases: false` or `mode: minimal` renders plain functional labels.
- **Non-invasive by construction.** The plugin registers no tools, appends no surface events, and never enters derived model history. Its only prompt contribution is the optional narration contract.
- **Optional invariant companion.** `./invariant` validates this package's own activity snapshots — both the legacy `activity/status` event and the current `plugin:working-activity/status` record — checking the phase vocabulary, non-empty line, and finite non-negative metrics for loaded sessions and every append thereafter.
- **One fold, three surfaces.** The node half owns the state machine; the TUI, Web UI, and GUI only render the projected value. No surface re-implements phase logic.

## How it works

The node half keeps one `ActivityTracker` per session. It is fed from four inputs:

1. **Durable session events** — `turn/start`, `step/start`, `assistant/message`, `tool/call`, `tool/result`, `turn/end`, `assistant/attempt`, `model/selection`, compaction and approval/retry signals.
2. **Live assistant-stream frames** — `agent/assistant-stream` (`start` / `chunk` / `end`), which carry streamed deltas, the first-token instant, and the `⏵` narration on the current host line.
3. **Agent status** — `agent/status` (`idle` / `running`).
4. **HUD feature events** — `request/context` (route context window), `todo/write`, `job/registered` / `job/settled`, `subagent/catalog`, `team/member` / `team/task`, `goal/change`, `plan/mode`, and `agent/inbox/spliced`. Missing features on older host lines are capability absence, not corruption: the badge is omitted.

The tracker renders a plain-text line and exposes the same value in two directions:

- **Projection** — a `workingActivity` session projection folds the durable log and is shipped to clients. This is the transport for the TUI, Web UI, and GUI.
- **Durable records** — with `publish: true`, the rendered snapshot is also appended as a log-only record for consumers that replay the session log. On DSH `0.2.x` this is an ignorable `plugin:working-activity/status` record; older corridors use the legacy `activity/status` event.

| Phase | Entered when | Example line |
|---|---|---|
| `waiting` | A turn is open and the model has not produced a token yet | `等待模型响应 · 总3s` |
| `thinking` | A live token or reasoning delta arrived | `嗯…让我捋捋 · 总12s` |
| `tool` | A `tool/call` is pending its result | `跑个命令 npm test · 12s` |
| `done` | The turn closed | `搞定 ✓ · 4 工具 · 想12s 干11s` |
| `idle` | No turn is active | *(nothing rendered)* |

## Requirements

- A DSH profile that composes the agent loop and a surface (TUI, Web UI, or GUI).
- Node `^22.19 || >=24`.
- `pnpm` is used by the official CLI when installing profile plugins.

## Installation

The package is a **self-mounting bundle**. It declares `dsh.bundle.patch` (`cordis.patch.yml`), and the official CLI both installs it and appends it to the profile's bundle layer stack. At boot, the bundle patch inserts the `working-activity` row into the composition tree; no manual mount is required.

```sh
dsh plugin --profile <profile> add dsh-working-activity
```

To change a value, override the row's config **by id** in the profile's user layer (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`). Do not insert a second row with the same id.

```yaml
- id: working-activity
  config:
    tickMs: 250
    publishIntervalMs: 500
```

Check the composed tree:

```sh
dsh --profile <profile> --dump-config
```

### TUI

TUI support ships with `dsh-tui`. `dsh-tui` depends on this package, and its profile mounts it through `@deepseek-harness-tui/dsh-tui/working-activity` (a re-export that pins `publish: false`); the working line is rendered from the `workingActivity` projection. `dsh-tui` also reuses the package's `./frames` presets and `./config` parser for its frame picker and `~/.dsh-tui/working-activity.json` settings.

Install `dsh-tui` into the profile; this plugin arrives as its dependency and must not be added a second time to the same profile:

```sh
dsh plugin --profile <profile> add @deepseek-harness-tui/dsh-tui
dsh --profile <profile>
```

A host that composes this package directly can still use it standalone; when it provides `ctx.tuiPrompt`, the `${activity}` template value is registered and can be opted into with:

```yaml
- id: tui
  config:
    theme:
      leftPrompt: '${cwd}${git/worktree}${activity}${model}${context}'
```

The current DSH line does not compose `tuiPrompt`; on that line the projection is the only TUI transport, and this template value is inert.

### Web UI

Install into a profile that composes the Web client, then boot that profile (the shipped `web` profile can also be booted directly with `dsh web`):

```sh
dsh plugin --profile <profile> add dsh-working-activity
dsh --profile <profile>
```

The browser half is a client bundle (`lib/client.js`, published in the package). The host's client-module loader scans loader entries for `dsh.client` declarations and serves the bundle to the shell. The bundle registers one entry on `conversation.input.dock` — id `activity`, order `15` — as a single dim row above the composer:

- phase-colored breathing marker, the host-composed line, and the turn's tool count;
- nothing rendered before the first value or while the phase is `idle`;
- the elapsed segment re-ticks locally every second while the value is `live`, because the projection itself changes only when a committed event folds.

The package declares the client cohort it uses:

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-ui-conversation",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-session"
    ]
  }
}
```

`dsh.client.inject` lists **boot rows** (package dependencies that must arrive first), not Cordis services. The client plugin's own `inject` export is `['slots']`. `@deepseek-ai/dsh-client-ui-slots` is a shell seed, not a boot row, so it is not listed in `dsh.client.inject`.

### Desktop GUI

The desktop GUI (`deepseek-harness-desktop`, Tauri) shares the Web client entry: the same `platform: "web"` declaration, the same `conversation.input.dock` seat, the same `useProjection('workingActivity')` read, and the same session projection on the host. The plugin runs inside the kernel Web client (React 18.3.1 on the current line), not the GUI host's React tree; the `react` peer range (`^18.2.0 || ^19.0.0`) covers both, so a React 19 host does not force a second React copy into the bundle.

Requirements on the GUI side are the same as the Web UI: compose the three boot rows above and expose `react/jsx-runtime` in the shell's module seed table. See [`docs/gui-compatibility.md`](../../../docs/gui-compatibility.md) for the verified contract, evidence, and known limits.

## Configuration

All keys are optional; the schema defaults below apply. Override them on the `working-activity` row in the profile's user layer.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `phrases` | `boolean` | `true` | Playful copy pool. `false` renders plain functional labels. `mode: minimal` turns it off unless set explicitly. |
| `publish` | `boolean` | `false` | Append a log-only working-activity record for consumers that replay the session log. On DSH `0.2.x` the record is ignorable (`plugin:working-activity/status`) and does not affect resume; older corridors fall back to the legacy `activity/status` event. The first-party surfaces read the projection and do not need it. See [Session-record contract](#session-record-contract). |
| `tickMs` | `number` | `500` | Status render tick, in ms (100–5000, step 50). Live phases wake on their own schedule, capped by this value. |
| `publishIntervalMs` | `number` | `2000` | Minimum interval between published events while the line is stable (500–30000, step 500). |
| `detailLimit` | `number` | `40` | Maximum displayed detail length for paths, commands, and patterns (8–120). |
| `customActions` | `object` | `{}` | Tool-name → action-copy pools, matched case-insensitively. Example: `{"my_deploy": ["部署一下", "上线中"]}`. |
| `narrate` | `boolean` | `true` | Inject the `⏵` self-narration contract into the system prompt and surface the extracted line. Set `false` for a purely event-derived line. |
| `lang` | `'auto' \| 'zh' \| 'en'` | `'auto'` | Copy language. `auto` resolves `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → OS locale → `zh`. |
| `frames` | `string` | `'moon8'` | Frame preset name. Informational for UI consumers; `dsh-tui` resolves the persisted frame choice itself. |
| `mode` | `'lively' \| 'minimal'` | `'lively'` | `minimal` keeps functional information only (plain labels, no playful pools); the context HUD remains. |
| `features` | `object` | `{}` | Per-feature switches; explicit values override `mode` defaults. |
| `customPhrases` | `string[]` | `[]` | Extra thinking phrases appended to the base pool. |
| `showTokPerSec` | `boolean` | `false` | Show an estimated `~tok/s` prefix while streaming. The value is derived from delta text, not provider usage. |
| `workRemindAt` | `number` | `0` | After this many hours of accumulated work, surface a break reminder (0–24; `0` disables). |
| `hud` | `boolean` | `true` | Master switch for the compact HUD suffix. `false` hides every badge. |
| `contextWarnAt` | `number` | `80` | Context-pressure percentage that adds `⚠` to the `ctx` badge. |
| `contextDangerAt` | `number` | `95` | Context-pressure percentage that adds `⛔` instead. |
| `debugLog` | `boolean` | `false` | Append a JSON trace of each distinct rendered line to `~/.dsh-tui/working-activity-debug.log` (or `DSH_WORKING_ACTIVITY_DEBUG_LOG`). |

Feature flags accepted by `features` and honoured by the tracker:

`phrases`, `rareEggs`, `nightPhrases`, `weekend`, `holidays`, `combo`, `failPhrases`, `modelQuips`, `continuePhrases`, `context`, `todos`, `jobs`, `subagents`, `team`, `goal`, `plan`, `queue`, `tokens`.

The HUD switches default on in `lively` mode. `minimal` keeps `context` (the warning is functional) and turns the rest off unless an explicit `features` entry enables it. The suffix is capped at four badges (five at `done`) and ordered by operational priority: context, jobs, todos, team/subagents, goal, plan, queue, tokens.

## Projection contract

The projection key is `workingActivity`. It is registered when the host composes the `sessionProjections` service; a profile without a projection registry skips it without error.

The DSH `0.2.x` definition contract:

| Field | Meaning |
|---|---|
| `key` | `'workingActivity'` |
| `stateSchema` | Validates the persisted fold state before it seeds a fold. |
| `stateVersion` | Persisted-cache invalidation version; bump when the snapshot shape or fold semantics change. |
| `init(header, inheritedEventCount)` | Initial state for the empty log. |
| `apply(state, event)` | Pure transition. Returns the **same reference** for events this unit does not model, so the host performs no downstream work. |
| `wire.viewSchema` | Validates the client-facing value before it leaves the host. |
| `wire.view(state)` | Renders the whole client value. |

The same definition object also carries the older registry spellings — top-level `schema`, `viewSchema`, `view`, and a zero-argument `init` — so one object registers on the `0.1.0-rc.6`, `0.1.2-alpha.2`, `0.1.7-rc.2`, and `0.2.x` registries without a version probe. `stateOf(session, key)` is used on hosts that expose it to overlay live-only facts (the current `⏵` narration and the first-token instant) onto the folded value; hosts without it fall back to the narration carried by settled messages.

The client-facing value:

```ts
interface WorkingActivityView {
  phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  line: string            // the line as the host rendered it
  live: boolean           // a live phase whose elapsed text should tick
  label?: string          // current tool action or stage label
  detail?: string         // path / command / pattern fragment
  phrase?: string         // current playful phrase or ⏵ narration
  toolCount: number       // tools completed this turn
  phaseStartedAt: number  // epoch ms the current phase began
  toolStartedAt?: number  // epoch ms the displayed (oldest) tool started
  turnStartedAt: number   // epoch ms the current turn began (0 when idle)
  updatedAt: number       // timestamp of the last folded event
  lang: 'zh' | 'en'       // language `line` was rendered in
}
```

Because the projection is event-driven, `line` can be older than the wall clock between folds. The wire value carries the timestamps so a client can re-tick the one moving segment; the Web and GUI halves do exactly that, and fall back to the host's text when the segment shape is unknown. A tool phase exposes `toolStartedAt` separately because the displayed tool is the OLDEST active one, while `phaseStartedAt` may have moved when a concurrent tool arrived.

`view` reuses the previous wire object when every field is unchanged. The RC2 registry compares consecutive view results with `Object.is`; reusing the reference is what suppresses publication for internal-only state changes (for example the no-op portion of a step boundary).

Read the value from a client plugin with the session standard kit:

```ts
const activity = useProjection('workingActivity')
```

## Session-record contract

`publish: true` appends a log-only working-activity record for consumers that replay the session log. It is **off by default**: the first-party TUI, Web UI, and GUI read the projection, and appending to the shared log is only useful to a replaying consumer.

**DSH `0.2.x` (`0.2.0-rc.2` / `0.2.1-rc.2`).** The write uses `session.appendPluginRecord()` with the record type `plugin:working-activity/status`. The host marks the record `ignorable: true`; an unrecognized record is retained and skipped, so it does not make the session unresumable.

**Older corridors (`0.1.0-rc.6` through `0.1.7-rc.2`).** `appendPluginRecord` does not exist there, so the plugin falls back to the legacy `activity/status` session event appended through `session.append()`. That generation has no ignorable marker, so at load the plugin registers the type in every reachable `dsh-session` copy — including the copy the persistence validator resolves — to keep resume and persistence reads working. Registration is unconditional and idempotent, and also covers logs written by an earlier `publish: true` configuration. A residual risk remains if a reader resolves a `dsh-session` copy the plugin cannot reach from its anchors; the first-party surfaces do not need publishing.

The payload is identical for both spellings:

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

Neither spelling carries a `surfaceOp`; neither enters derived model history.

Publishing rules: a line change publishes immediately; a stable line republishes at most every `publishIntervalMs`, so a long tool's elapsed time stays live without flooding the log. Optional fields are omitted when absent; the payload is lossless JSON.

The optional invariant companion validates both spellings: the legacy `activity/status` event and the current `plugin:working-activity/status` record.

## Compatibility

The node half supports the host lines below. The surface columns describe which rendering transports are available on that line; the transport is always the `workingActivity` projection, except for the opt-in log-record consumer noted in the last column.

| DSH host line | TUI (`dsh-tui`) | Web UI | Desktop GUI | Verification |
|---|---|---|---|---|
| `0.1.0-rc.6` | Maintained¹ | Not supported | Not supported | Legacy projection-shape test; runtime registration fixture |
| `0.1.2-alpha.2` | Maintained¹ | Not supported | Not supported | `pnpm run test:alpha2` (published host graph fixture) |
| `0.1.7-rc.2` | Supported | Supported | Not applicable² | `pnpm run test:rc2` (published host graph fixture) |
| `0.2.0-rc.2` | Supported | Supported | Supported³ | Main suite + RC2 host fixture + client-bundle gate + GUI contract gate |
| `0.2.1-rc.2` | Supported | Supported | Supported³ | Main suite + RC2 host fixture + client-bundle gate + GUI contract gate |

¹ Maintained for compatibility and exercised by isolated fixtures / shape assertions; the main development tree is no longer compiled against this line.
² The desktop GUI ships the 0.2.x kernel line; `0.1.7-rc.2` is not a GUI target.
³ The desktop GUI reuses the Web client entry. GUI `0.22.4` recommends DSH `0.2.0-rc.2`, which the peer range covers. `docs/gui-compatibility.md` records the verified contract, evidence, and remaining limits.

Notes:

- **TUI** requires a `dsh-tui` release whose DSH adapter supports the same host line. The current `dsh-tui` line targets `0.2.x` and maintains its own activity-line/projection consumption; it mounts this package with `publish: false`. The `${activity}` prompt slot is registered only when the host composes `tuiPrompt`, which the current DSH line does not.
- **Web UI** requires the `0.1.7-rc.2`, `0.2.0-rc.2`, or `0.2.1-rc.2` client cohort. The browser bundle is built against the RC2 shell seed table (`react`, `react/jsx-runtime`, `react-dom`, `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`, `@deepseek-ai/dsh-client-store`, `-ui-slots`, `-ui-primitives`, `-ui-dockkit`); the `0.1.7-rc.2` shell is a subset that also resolves the bundle's only value import, `react/jsx-runtime`.
- **Desktop GUI** shares the Web entry: `platform: "web"`, the same dock seat, and the same projection. React 19 is covered by the peer range; the plugin itself runs inside the kernel Web client (React 18.3.1 on the current line), not the GUI host's React tree. The GUI must seed `react/jsx-runtime` and compose the three boot rows listed above. Run `pnpm run verify:gui` to check the GUI contract (the gate skips when the GUI checkout is absent).
- **Legacy record consumers** (for example terminal UIs that replay the session log) can set `publish: true` on any supported line. On `0.2.x` this is an ignorable plugin record; on older lines it is the legacy `activity/status` event backed by the registration shim.
- **HUD availability** is composition- and log-dependent: `request/context`, `todo/write`, `goal/change`, `plan/mode`, `team/*`, and `subagent/catalog` exist on the `0.1.2-alpha.2` line; `job/*` and `agent/inbox/spliced` appear on the `0.1.7+` line (not on `0.1.2-alpha.2`). A missing source renders no badge — never a guessed value.

## Architecture

```
src/
  index.ts                 plugin entry: row config, per-session runtimes,
                           TUI prompt slot, narration section, publish sink
  status.ts                pure ActivityTracker state machine and renderer
  phrases.ts               bilingual copy pools and selection
  frames.ts                frame presets (shared with dsh-tui)
  lang.ts                  language resolution and copy dictionary
  config.ts                file-based working-activity config parser
  projection.ts            workingActivity session projection (all corridors)
  events.ts                activity/status event + plugin-record type merge
  registration.ts          legacy-corridor session-event type registration shim
  invariant.ts             optional dsh-invariants companion
  compat/
    session-events.ts      durable SessionEvent → ActivityEvent
    assistant-stream.ts    live agent/assistant-stream frame → ActivityEvent
    tool-result.ts         tool/result call-id and failure readers
  client/
    index.ts               client entry: dock registration
    WorkingLine.tsx        dock component
    elapsed.ts             local elapsed re-tick
    activity.ts            projection-key type merge
    WorkingLine.module.css
cordis.patch.yml           self-mounting bundle patch
```

The split is intentional: `status.ts`, `phrases.ts`, `frames.ts`, and `lang.ts` are pure and clock-injected; every host-shape guess lives in `src/compat/`; the client half imports types only and contains no domain folding.

### Model impact

- **Tools:** none registered.
- **Surface events:** none appended by default. Published snapshots are log-only: an ignorable plugin record on `0.2.x`, or a legacy `activity/status` event on older lines. Neither can reach the model.
- **Prompt:** one fixed system-prompt section when `narrate: true` (the `⏵` contract). Set `narrate: false` for no prompt contribution.
- **Tokens per request:** zero, except that fixed narration section.
- **KV cache:** the narration section is static per language and does not vary per turn.

## Development

```sh
cd packages/activity/working-activity
pnpm install --frozen-lockfile
pnpm run build              # host tsc + client tsc into lib/types/
pnpm run build:client       # browser bundle into lib/client.js
pnpm test                   # unit + host integration tests (vitest)
pnpm run verify:deps        # manifest dependency gate
pnpm run verify:lockfiles   # lockfile agreement gate
pnpm run verify:host-vocabulary
pnpm run verify:client-bundle
pnpm run verify:gui         # desktop GUI contract (skips when the GUI checkout is absent)
pnpm run prepublishOnly     # all publish gates
pnpm run test:alpha2        # isolated 0.1.2-alpha.2 host fixture
pnpm run test:rc2           # isolated 0.2.1-rc.2 host fixture
```

The main development graph is pinned to DSH `0.2.1-rc.2` (Cordis 4.0.5). The `test:alpha2` and `test:rc2` fixtures each carry their own lockfile and published host graph, so mutually exclusive peer sets never mix. A parent rebuild must be followed by a fixture reinstall (`pnpm run test:rc2` does both).

The client bundle is a closure-factory artifact loaded with `window.__ModuleLoader__.load({ id, factory })`. It is checked without a browser: loader contract, module-specifier purity against the RC2 seed table, declared client row, and the dock registration + render branches.

## Troubleshooting

**No line in the TUI.** Confirm the plugin is present in the composed profile (`dsh --profile <profile> --dump-config`) and that the `dsh-tui` release supports the host line. The TUI reads the projection; `publish` does not affect it.

**No line in the Web UI.** Confirm that the installed package contains `lib/client.js`, that the profile composes the three boot rows, and that the browser console has no `MissingClientBundleError`. For a packaging change, run `pnpm run verify:client-bundle`.

**Tool count stays at 0 and the line freezes on the first tool.** This is the pre-`0.1.7-rc.2` `tool/result` correlation break. Upgrade to the current package release; the fix reads the call id from `message.source.callId` / `message.toolCallId` and the failure flag from `message.isError`.

**A session fails to resume after enabling `publish`.** On DSH `0.2.0-rc.2` / `0.2.1-rc.2`, published snapshots are ignorable plugin records and cannot block resume. On older corridors the plugin registers the legacy type in every reachable `dsh-session` copy; if a reader resolves a copy the plugin cannot reach, disable `publish`. The first-party surfaces do not need it.

**The invariant companion does not run.** The bundle patch mounts only the `working-activity` row. Add the registry and companion rows explicitly in the profile's user layer:

```yaml
- insert:
    - id: invariants
      name: '@deepseek-ai/dsh-invariants'
    - id: working-activity-invariant
      name: 'dsh-working-activity/invariant'
```

Skip the `invariants` row where the composition already mounts the registry.

**Copy appears in the wrong language.** Set `lang: zh` or `lang: en` on the row, or control the shared chain (`DSH_TUI_LANG`, `~/.dsh-tui/lang.json`, OS locale). The resolved language is also carried on the projection so clients tick in the same language.

**The line says something unexpected.** Set `debugLog: true`; each distinct rendered line is appended as JSON with the derivation inputs (phase, copy pool, slot) to `~/.dsh-tui/working-activity-debug.log`. Use `DSH_WORKING_ACTIVITY_DEBUG_LOG` to redirect the trace.

## Privacy and security

The plugin collects no data, makes no network requests, and has no telemetry. Status values are derived locally from the session stream. With `publish: true`, snapshots are written only to the local session log — as an ignorable plugin record on `0.2.x`, or a log-only `activity/status` event on older corridors — and never enter model history. `customActions`, copy pools, and language preference stay in local configuration.

## License

BSD-3-Clause. See [`LICENSE`](LICENSE).

The `pi-working-activity` extension in the repository root is a separate package under the MIT license; see the [repository README](../../../README.md).
