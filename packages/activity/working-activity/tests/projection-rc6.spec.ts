/**
 * rc.6 corridor: the plugin's projection unit registers on the OLD contract.
 *
 * The definition serves three contract shapes at once (see src/projection.ts):
 * the rc.6-era `schema`/`view`, alpha.2's top-level `viewSchema`, and the current
 * `wire: { viewSchema, view }`. Two of those have live runtime proof in their own
 * fixture; this one runs the rc.6 registry itself — the package is installed
 * under an alias (`dsh-session-projection-rc6`) because the dev tree already
 * carries the 0.1.7 line for the Web half's type merge.
 *
 * What it proves is not the value's content (the current corridor's fixture does
 * that) but that THIS registry accepts the unit and drives it: a definition that
 * only satisfied the newer shape would register here and then fail to render, or
 * refuse to register at all.
 * @module @deepseek-ai/dsh-working-activity/tests/projection-rc6
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from 'dsh-session-projection-rc6'
import * as WorkingActivity from '../src/index'
import { setLangOverride } from '../src/lang.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter'

beforeEach(() => setLangOverride('zh'))
afterEach(() => setLangOverride('auto'))

const KEY = 'workingActivity'

describe('rc.6 projection corridor', () => {
  it('registers the unit and serves the folded value to a reader', async () => {
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      // The rc.6 testkit does not mount the projection registry; this corridor's
      // compositions do (dsh-base carries the row), so mount the real service.
      await ctx.plugin(SessionProjectionRegistry as never)
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
      const agent = await ctx.agentLoop.create(SessionId('rc6-projection'), { provider: 'mock', model: 'mock' })
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
      console.log(`[rc6 projection] wire value: ${JSON.stringify(wire)}`)
      console.log(`[rc6 projection] change feed: ${pushed.length} pushes`)

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
