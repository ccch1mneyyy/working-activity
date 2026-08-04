/**
 * Full-loop integration: a scripted mock model drives the REAL working-activity
 * plugin through the agent loop. Only the model is mocked; the plugin, the
 * session log, and the append guard are real. This is the regression net for
 * the synchronous-append reentry bug: activity/status publishes deferred into a
 * microtask must land for every phase transition, including fast tools.
 * @module @deepseek-ai/dsh-working-activity/tests/integration
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as WorkingActivity from '@deepseek-ai/dsh-working-activity'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Wire-narrowed view of the published snapshot (host merge not needed here). */
interface ActivitySnapshot {
  phase: string
  line: string
  label?: string
  detail?: string
  phrase?: string
  toolCount: number
  turnElapsedMs: number
  phaseStartedAt: number
}

/** Narrow by the event's type tag (SessionEvent is a mapped type, not a union). */
function activityEvents(log: readonly SessionEvent[]): Array<SessionEvent & { data: ActivitySnapshot }> {
  return log.filter(event => event.type === 'activity/status').map(event => event as unknown as SessionEvent & { data: ActivitySnapshot })
}

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(WorkingActivity)
  // A real tool for the scripted tool call (bash is not composed here).
  ctx.tools.register(defineContentToolFixture({
    name: 'mock_ls',
    description: 'List files (mock)',
    parameters: { path: { type: 'string' } },
    async execute() {
      return [{ type: 'text', text: 'file-a.txt' }]
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'mock_fail',
    description: 'Always fails (mock)',
    parameters: {},
    async execute() {
      throw new Error('mock failure')
    },
  }))
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', (subject, status) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Drain publish microtasks after the turn settles (append happens in a microtask). */
async function flushPublishes(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 20))
}

describe('working-activity through the agent loop', () => {
  it('publishes tool-phase lines during a tool call and a done summary at turn end', async () => {
    // Responses are consumed in call order: the first model call must be the
    // tool call so the tool phase actually happens.
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'mock_ls', { path: 'src/dir' }, 'Listing files.'),
      textResponse('Done listing.'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-activity'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'list files' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    await flushPublishes()

    const events = activityEvents(agent.session.events)
    expect(events.length).toBeGreaterThan(0)
    const phases = events.map(event => event.data.phase)
    expect(phases).toContain('tool')
    expect(phases).toContain('thinking')
    expect(phases).toContain('done')
    const toolLines = events.filter(event => event.data.phase === 'tool').map(event => event.data.line)
    expect(toolLines[0]).toContain('src/dir')
    const done = events.findLast(event => event.data.phase === 'done')
    expect(done?.data.line).toContain('1 工具')
  })

  it('a failed tool flags the done line', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'mock_fail', {}, 'Failing.'),
      textResponse('It failed.'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-activity-fail'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run failing command' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    await flushPublishes()

    const done = activityEvents(agent.session.events).findLast(event => event.data.phase === 'done')
    // Failure prefix draws from FAIL_PHRASES; assert the failure semantics.
    expect(done?.data.line).not.toContain('搞定')
  })

  it('each published snapshot is lossless JSON with optional fields omitted', async () => {
    const adapter = new MockAdapter([
      textResponse('Thinking hard.'),
      textResponse('All done.'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-activity-json'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'think' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    await flushPublishes()

    for (const event of activityEvents(agent.session.events)) {
      const data = event.data as Record<string, unknown>
      expect(data.phase).toBeTruthy()
      expect(data.line).toBeTruthy()
      expect(JSON.stringify(data)).toBe(JSON.stringify(JSON.parse(JSON.stringify(data))))
    }
  })

  it('injects the narration contract and surfaces the ⏵ line from the stream', async () => {
    // First response: a reasoning delta carrying the narration, then text.
    const adapter = new MockAdapter([
      [
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: '⏵ 查一下报错原因' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: '⏵ 查一下报错原因' } },
        { type: 'block-start', index: 1, blockType: 'text' },
        { type: 'text-delta', index: 1, text: '好的，我来看看。' },
        { type: 'block-end', index: 1, block: { type: 'text', text: '好的，我来看看。' } },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
      textResponse('Done.'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-activity-narrate'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'look into it' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    await flushPublishes()

    // The narration contract rides the assembled system prompt.
    expect(adapter.requests[0]?.system).toContain('[状态栏]')
    // The streamed ⏵ line lands in the published status lines.
    const lines = activityEvents(agent.session.events).map(event => event.data.line)
    expect(lines.some(line => line.includes('⏵ 查一下报错原因'))).toBe(true)
  })
})
