import { describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  KNOWN_SESSION_EVENT_TYPES,
  SessionId,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as WorkingActivity from 'dsh-working-activity'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

interface ActivitySnapshot {
  phase: string
  line: string
  toolCount: number
}

/** Select the working-activity snapshots from a session transcript. */
function activityEvents(log: readonly SessionEvent[]): Array<SessionEvent & { data: ActivitySnapshot }> {
  return log
    .filter(event => event.type === 'activity/status')
    .map(event => event as unknown as SessionEvent & { data: ActivitySnapshot })
}

/** Resolve once the target agent returns to idle. */
async function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  await new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

describe('DSH 0.1.2-alpha.2 compatibility', () => {
  it('mounts the packaged plugin and completes a tool turn', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('alpha-call-1', 'mock_ls', { path: 'src/dir' }),
      textResponse('Done listing.'),
    ])
    const ctx = new Context()
    // Keep the plugin's own fiber so teardown can unload WorkingActivity
    // first: its tick timer (`setInterval`) is cleared by the fiber's effect
    // disposer on dispose, before the whole context is torn down.
    let activityFiber: Fiber | undefined
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(AgentLoop, { agents: [] })
      activityFiber = await ctx.plugin(WorkingActivity, { publish: true, lang: 'zh' })
      ctx.tools.register(defineContentToolFixture({
        name: 'mock_ls',
        description: 'List files (mock)',
        parameters: { path: { type: 'string' } },
        async execute() {
          return [{ type: 'text', text: 'file-a.txt' }]
        },
      }))
      ctx.llm.registerAdapter(['mock'], adapter)

      expect(KNOWN_SESSION_EVENT_TYPES.has('activity/status')).toBe(true)
      const agent = ctx.agentLoop.create(SessionId('alpha2-activity'), {
        provider: 'mock',
        model: 'mock',
      })
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'list files' }],
        source: { kind: 'user' },
      }))
      await waitForIdle(ctx, agent)
      await new Promise(resolve => setTimeout(resolve, 20))

      const events = activityEvents(agent.session.events)
      expect(events.map(event => event.data.phase)).toContain('tool')
      expect(events.findLast(event => event.data.phase === 'done')?.data.line).toContain('1 工具')
    } finally {
      await activityFiber?.dispose()
      await ctx.fiber.dispose()
    }
  })
})
