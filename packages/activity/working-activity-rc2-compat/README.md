# DSH 0.2.1-rc.2 compatibility fixture

This private fixture runs the `dsh-working-activity` Host integration against
the published DSH `0.2.1-rc.2` package graph (`@deepseek-ai/cordis@4.0.5` plus
every `@deepseek-ai/dsh-*` at exactly `0.2.1-rc.2`). It is never published.

Two pins are deliberate exceptions with no matching release:

- `@deepseek-ai/dsh-invariants` stays at `0.2.0-rc.2`, the newest published
  package in the 0.2 line (there is no `0.2.1-rc.2`).
- `dsh-agent-loop-testkit@0.2.1-rc.2` imports `@deepseek-ai/dsh-fs-local` and
  `@deepseek-ai/dsh-working-directory`; both are pinned here at `0.2.1-rc.2`
  because the package declares them as peers even when the fixture does not
  mount them.

It is isolated on both sides: it does not share the main package's older
Host/Web development graph, and it is a separate tree from
`../working-activity-alpha2-compat`, which stays pinned to the
`0.1.2-alpha.2` corridor. The fixtures exist so every supported corridor can
be tested in one checkout without any one dependency pin leaking into another.

The fixture consumes `dsh-working-activity` as an *injected* copy of
`../working-activity`, so the parent package must be BUILT first — the injected
copy resolves `lib/types/index.js`, not `src/`. pnpm materializes that copy as
hard links into this fixture's `node_modules`, and a rebuild replaces the
parent's `lib/` files with new inodes, so the fixture keeps the OLD build until
it is reinstalled. Re-run `install` (not just `build`) after every parent
rebuild:

```console
# from ../working-activity
pnpm run build
pnpm --dir ../working-activity-rc2-compat install --strict-peer-dependencies
pnpm --dir ../working-activity-rc2-compat test
```

What it covers:

- **Scope probe** — whether `agent/assistant-stream` frames reach a listener
  registered by a plugin mounted through `ctx.plugin(...)`, and how many reach a
  root-level listener, during one scripted tool turn. The frames are asserted
  against the 0.2.x `start` / dense `chunk`* / `end` contract: attempt id and
  monotone revision on every frame, chunk `index`/`time`/`chunk` payloads, and a
  terminal `end.index` equal to the chunk count.
- **RC2 session seams** — `session.events` is gone (asserted absent), the
  frozen `snapshotEvents()` read agrees with the post-commit `session/event`
  feed, and the new `appendPluginRecord` / `pluginRecordOf` channel round-trips
  a `plugin:` record carrying the envelope's `ignorable` marker without entering
  the released event catalog or the model-visible surface. The plugin's
  `publish: true` sink is asserted to take that channel too (an ignorable
  `plugin:working-activity/status` record, no legacy `activity/status` row),
  while `publish: false` stays log-silent. The 0.2.1 vocabulary
  (`assistant/attempt`, `job/registered`, `job/settled`,
  `working-directory/change`) is present; `assistant/chunk` is not.
- **P0 regression guard** — the tool phase must settle before `turn/end`, and
  the final `done` snapshot must count the tool. These cases were RED for
  `dsh-working-activity@0.4.0` (the tracker read
  `message.content[0].toolCallId`; this host writes `message.source.callId`),
  and they stay as the regression guard now that `src/` is migrated.
- **Projection transport** — the `workingActivity` projection registers on the
  0.2.1 `register({ key, stateSchema, stateVersion, init(header,
  inheritedEventCount), apply, wire: { viewSchema, view } })` contract, folds a
  real turn, pushes the same wire value through `snapshot()` and `onChanged`,
  enforces both schemas, and never appends a row to the session log.
- **Fixture honesty** — `fixtures.ts` carries one modern and one legacy
  `tool/result` payload, and the assertions over their key paths keep the two
  wire generations from being mixed into a "support both" edit.
