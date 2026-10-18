/**
 * Projection registry corridor: the definition's legacy spellings stay live.
 *
 * The plugin serves several registry contract shapes at once (see
 * `src/projection.ts`): the rc.6-era `schema`/`view`, alpha.2's top-level
 * `viewSchema`, and the current `wire: { viewSchema, view }`. This suite has two
 * jobs:
 *
 * 1. prove the legacy spellings are still carried on the built definition, so
 *    an older registry that reads only `schema` / `view` can consume it; and
 * 2. drive the definition through the current `sessionProjections` registry
 *    (mounted by `mountAgentLoopTestDependencies` on the 0.2.x line) and assert
 *    a real turn folds into a served value on the change feed.
 *
 * The live rc.6 registry itself is no longer part of this development graph:
 * the main tree is pinned to DSH `0.2.1-rc.2`, and two registries cannot share
 * the `sessionProjections` service in one Context. Runtime proof for the old
 * corridor lives in the isolated compatibility fixtures; this file keeps the
 * contract shape honest in the main tree.
 * @module @deepseek-ai/dsh-working-activity/tests/projection-registry
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as WorkingActivity from '../src/index'
import { createActivityProjection } from '../src/projection'
import { setLangOverride } from '../src/lang.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter'

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

const KEY = 'workingActivity'

describe('projection definition corridors', () => {
  it('carries the legacy registry spellings on the built definition', () => {
    const definition = createActivityProjection({
      trackerConfig: { phrases: true, detailLimit: 40, showIdle: false, features: {} },
      lang: () => 'zh',
    })
    // The rc.6 and alpha.2 registries read these top-level spellings; the
    // current registry reads `wire`. All three must exist on one object.
    expect(typeof definition.schema?.safeParse).toBe('function')
    expect(typeof definition.viewSchema?.safeParse).toBe('function')
    expect(typeof definition.view).toBe('function')
    expect(typeof definition.wire?.viewSchema?.safeParse).toBe('function')
    expect(typeof definition.wire?.view).toBe('function')
    expect(typeof definition.init).toBe('function')
    expect(typeof definition.apply).toBe('function')
    expect(definition.stateVersion).toBeGreaterThan(0)
  })

  it('registers on the current registry and serves the folded value to a reader', async () => {
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(WorkingActivity, { publish: false, lang: 'zh' })
      ctx.tools.register(defineContentToolFixture({
        name: 'probe_echo',
        description: 'Echo (probe)',
        parameters: { path: { type: 'string' } },
        async execute() {
          return [{ type: 'text', text: 'ok' }]
        },
      }))

      const pushed: unknown[] = []
      const registry = (ctx as unknown as {
        sessionProjections: {
          onChanged(listener: (session: unknown, key: string, value: unknown) => void): () => void
          snapshot(session: unknown, keys?: readonly string[]): { values: Record<string, unknown> }
        }
      }).sessionProjections
      const off = registry.onChanged((_session, key, value) => {
        if (String(key) === KEY) pushed.push(value)
      })

      const adapter = new MockAdapter([
        toolCallResponse('call-1', 'probe_echo', { path: 'src' }, 'Listing files.'),
        textResponse('Done listing.'),
      ])
      ctx.llm.registerAdapter(['mock'], adapter)
      const agent = await ctx.agentLoop.create(SessionId('projection-registry'), { provider: 'mock', model: 'mock' })
      const idle = new Promise<void>((resolve) => {
        const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
          if (subject !== agent || status !== 'idle') return
          dispose()
          resolve()
        })
      })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'list files' }], source: { kind: 'user' } }))
      await idle
      await new Promise(resolve => setTimeout(resolve, 20))
      off()

      const values = registry.snapshot(agent.session, [KEY]).values
      const wire = values[KEY] as Record<string, unknown> | undefined
      // Registered on this corridor's contract shape…
      expect(wire).toBeDefined()
      // …and driven by it: the value reflects the turn that ran.
      expect(wire?.phase).toBe('done')
      expect(wire?.toolCount).toBe(1)
      expect(wire?.lang).toBe('zh')
      // The push path a client lives on must also fire on this registry.
      expect(pushed.length).toBeGreaterThan(0)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 30_000)
})
