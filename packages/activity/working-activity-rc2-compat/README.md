# DSH 0.1.7-rc.2 compatibility fixture

This private fixture runs the `dsh-working-activity` Host integration against
the published DSH `0.1.7-rc.2` package graph (`@deepseek-ai/cordis@4.0.4` plus
every `@deepseek-ai/dsh-*` at exactly `0.1.7-rc.2`). It is never published.

It is isolated on both sides: it does not share the main package's older
Host/Web development graph, and it is a separate tree from
`../working-activity-alpha2-compat`, which stays pinned to the
`0.1.2-alpha.2` corridor. The two fixtures exist so both corridors can be
tested in one checkout without either one's dependency pins leaking into the
other.

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
pnpm --dir ../working-activity-rc2-compat install
pnpm --dir ../working-activity-rc2-compat test
```

What it covers:

- **Scope probe** — whether `agent/assistant-stream` frames reach a listener
  registered by a plugin mounted through `ctx.plugin(...)`, and how many reach a
  root-level listener, during one scripted tool turn.
- **P0 reproduction** — the tool phase of `dsh-working-activity@0.4.0` on this
  host line never settles before `turn/end` (the tracker reads
  `message.content[0].toolCallId`; this host writes `message.source.callId`),
  so the final `done` snapshot counts 0 tools. Expected RED until `src/` is
  migrated.
- **Fixture honesty** — `fixtures.ts` carries one modern and one legacy
  `tool/result` payload, and the assertions over their key paths keep the two
  wire generations from being mixed into a "support both" edit.
