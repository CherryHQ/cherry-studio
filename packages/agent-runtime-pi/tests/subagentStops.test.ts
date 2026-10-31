import type { AssistantMessage } from '@earendil-works/pi-ai'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort } from '../src'
import { assistantReply, createTestSession, lastAssistant, MODEL } from './sessionSupport'
import {
  noteTool,
  outputText,
  recordingSubagentPort,
  routedModel,
  stopTurnTool,
  subagentCall,
  toolCallPart,
  toolResultOf,
  toolResults
} from './subagentSupport'

const TASK_A = { description: 'Check A', prompt: 'TASK-A' }
const upstreamError = { ...assistantReply([], 'error', 0, 0), errorMessage: 'upstream exploded' }

/** Parent delegates TASK-A once; `child` scripts the subagent. */
function delegate(child: (lastRole: string) => AssistantMessage) {
  return routedModel(({ userText, lastRole }) => {
    if (userText.includes('TASK-A')) return child(lastRole)
    return lastRole === 'user'
      ? assistantReply([subagentCall('call_a', TASK_A)], 'toolUse')
      : assistantReply([{ type: 'text', text: 'Done' }])
  })
}

describe('subagent stops', () => {
  it('reports a failed subagent as an error with its partial output and usage', async () => {
    const { model } = delegate((lastRole) =>
      lastRole === 'user'
        ? assistantReply([{ type: 'text', text: 'PARTIAL-A' }, toolCallPart('note_1', 'note')], 'toolUse', 100, 20)
        : upstreamError
    )
    const { session } = await createTestSession({
      stream: model,
      tools: [noteTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    const result = toolResultOf(session, 'call_a')
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ outcome: 'failed' })
    const message = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
    expect(message).toContain('upstream exploded')
    expect(message).toContain('PARTIAL-A')
    expect(result.usage?.totalTokens).toBe(122)
  })

  it('reports a subagent cut off by its output limit as truncated', async () => {
    const { model } = delegate(() => assistantReply([{ type: 'text', text: 'HALF-A' }], 'length'))
    const { session } = await createTestSession({
      stream: model,
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    const result = toolResultOf(session, 'call_a')
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ outcome: 'truncated' })
    expect(result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')).toContain('HALF-A')
  })

  it('returns the report of one subagent when its sibling fails', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return upstreamError
      if (userText.includes('TASK-B')) return assistantReply([{ type: 'text', text: 'REPORT-B' }])
      return lastRole === 'user'
        ? assistantReply(
            [subagentCall('call_a', TASK_A), subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B' })],
            'toolUse'
          )
        : assistantReply([{ type: 'text', text: 'Done' }])
    })
    const { session } = await createTestSession({
      stream: model,
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Check modules A and B')

    const [a, b] = toolResults(calls.at(-1)!)
    expect(a.content[0].type).toBe('text')
    expect(outputText(b.content)).toMatch(/^REPORT-B\n\n\(id: /)
  })

  it('stops the subagent and shuts it down when the parent turn aborts', async () => {
    const parent: { session?: AgentSession } = {}
    let shutdowns = 0
    const { model, calls } = delegate((lastRole) =>
      lastRole === 'user'
        ? assistantReply([toolCallPart('stop_1', 'stop_turn')], 'toolUse')
        : assistantReply([{ type: 'text', text: 'LATE' }])
    )
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('session_shutdown', () => void shutdowns++)
        }
      ]
    }))
    const runtime = await createTestSession({
      stream: model,
      tools: [stopTurnTool(parent)],
      subagents: host.port
    })
    parent.session = runtime.session

    await runtime.session.prompt('Delegate the check')

    expect(shutdowns).toBe(1)
    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(1)
    const childEvents = host.events.get(host.subagents[0].sessionId)!
    expect(childEvents.at(-1)).toMatchObject({ type: 'turn-complete', aborted: true })
    expect(toolResultOf(runtime.session, 'call_a').details).toMatchObject({ outcome: 'aborted' })
  })

  it('does not let a subagent run when the turn aborts while its before_agent_start handlers run', async () => {
    const parent: { session?: AgentSession } = {}
    const { model, calls } = delegate(() => assistantReply([{ type: 'text', text: 'REPORT-A' }]))
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('before_agent_start', async () => {
            void parent.session!.abort()
            await new Promise((resolve) => setTimeout(resolve, 0))
          })
        }
      ]
    }))
    const runtime = await createTestSession({ stream: model, subagents: host.port })
    parent.session = runtime.session

    await runtime.session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(0)
    expect(toolResultOf(runtime.session, 'call_a').details).toMatchObject({ outcome: 'aborted' })
  })

  // Breaks when an abort made before Pi starts preparing the subagent's run (while its `input` handlers
  // run, which Pi ignores) is dropped: the subagent would still send its requests.
  it('does not let a subagent run when the turn aborts while its input handlers run', async () => {
    const parent: { session?: AgentSession } = {}
    const { model, calls } = delegate(() => assistantReply([{ type: 'text', text: 'REPORT-A' }]))
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('input', async () => {
            void parent.session!.abort()
            await new Promise((resolve) => setTimeout(resolve, 0))
            return { action: 'continue' }
          })
        }
      ]
    }))
    const runtime = await createTestSession({ stream: model, subagents: host.port })
    parent.session = runtime.session

    await runtime.session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(0)
    expect(toolResultOf(runtime.session, 'call_a').details).toMatchObject({ outcome: 'aborted' })
  })

  it('does not start a subagent when the turn aborts before the host finishes configuring it', async () => {
    const parent: { session?: AgentSession } = {}
    const { model, calls } = delegate(() => assistantReply([{ type: 'text', text: 'REPORT-A' }]))
    const host = recordingSubagentPort(async () => {
      void parent.session!.abort()
      await new Promise((resolve) => setTimeout(resolve, 0))
      return {}
    })
    const runtime = await createTestSession({ stream: model, subagents: host.port })
    parent.session = runtime.session

    await runtime.session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(0)
    expect(host.sessions.size).toBe(0)
    expect(toolResultOf(runtime.session, 'call_a').details).toMatchObject({ outcome: 'aborted' })
  })

  it('fails the call when the host cannot configure the subagent, and the parent continues', async () => {
    const port: SubagentPort = {
      configure() {
        throw new Error('no workspace for subagents')
      }
    }
    const { model, calls } = delegate(() => assistantReply([{ type: 'text', text: 'REPORT-A' }]))
    const { session } = await createTestSession({ stream: model, subagents: port })

    await session.prompt('Delegate the check')

    const [result] = toolResults(calls.at(-1)!)
    expect(result.content[0].type).toBe('text')
    expect(outputText(result.content)).toContain('no workspace for subagents')
    expect(lastAssistant(session).stopReason).toBe('stop')
  })

  it('stops a subagent after 200 model requests', { timeout: 60_000 }, async () => {
    let next = 0
    const { model, calls } = delegate(() => assistantReply([toolCallPart(`note_${++next}`, 'note')], 'toolUse'))
    const { session } = await createTestSession({
      stream: model,
      tools: [noteTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(200)
    const result = toolResultOf(session, 'call_a')
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ outcome: 'limit_reached' })
  })

  // Breaks when only agent turns are counted: Pi's summarizer makes its own requests through the port.
  it('stops a subagent after 200 model requests, compaction summaries included', { timeout: 60_000 }, async () => {
    let next = 0
    const page = 'x'.repeat(9_000)
    const pageTool = defineTool({
      name: 'fetch_page',
      label: 'Fetch page',
      description: 'Fetch a page',
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: 'text', text: page }], details: undefined }
      }
    })
    // Reports the prompt's real size so Pi's context accounting crosses the threshold every few pages.
    const { model, requests } = routedModel(({ userText, lastRole, options }) => {
      // Pi's summary requests carry no tools.
      if ((options.tools ?? []).length === 0)
        return assistantReply(
          'Summary: paging through TASK-A.',
          'stop',
          Math.ceil(JSON.stringify(options.messages).length / 3.5),
          20
        )
      if (userText.includes('TASK-A'))
        return assistantReply(
          [toolCallPart(`page_${++next}`, 'fetch_page')],
          'toolUse',
          Math.ceil(JSON.stringify(options.messages).length / 3.5),
          20
        )
      return lastRole === 'user'
        ? assistantReply([subagentCall('call_a', TASK_A)], 'toolUse')
        : assistantReply([{ type: 'text', text: 'Done' }])
    })
    const { session } = await createTestSession({
      stream: model,
      model: { ...MODEL, contextWindow: 9_000 },
      tools: [pageTool],
      compaction: { reserveTokens: 2_000, keepRecentTokens: 3_000 },
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    // Pi gives each summary request a fresh session id; the parent itself never compacts here.
    const parentId = session.sessionManager.getSessionId()
    const subagentRequests = requests.filter((request) => request.sessionId !== parentId)
    expect(subagentRequests.filter((request) => Object.keys(request.tools ?? {}).length === 0).length).toBeGreaterThan(
      0
    )
    expect(subagentRequests).toHaveLength(200)
    expect(toolResultOf(session, 'call_a').details).toMatchObject({ outcome: 'limit_reached' })
  })

  it('stops a subagent after 200 model requests that bring no tool results', { timeout: 60_000 }, async () => {
    const { model, calls } = delegate(() => assistantReply([{ type: 'text', text: 'AGAIN' }]))
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('turn_end', () => {
            pi.sendUserMessage('Keep going', { deliverAs: 'followUp' })
          })
        }
      ]
    }))
    const { session } = await createTestSession({ stream: model, subagents: host.port })

    await session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(200)
    expect(toolResultOf(session, 'call_a').details).toMatchObject({ outcome: 'limit_reached' })
  })

  // Breaks when the cap counts only the requests that pass `agent.streamFunction`: Pi's cache warmer
  // re-sends the latest request through the model runtime while a long tool runs.
  it('stops a subagent after 200 model requests, Pi cache-warming requests included', { timeout: 60_000 }, async () => {
    const buildTool = defineTool({
      name: 'build',
      label: 'Build',
      description: 'Run the build',
      parameters: Type.Object({}),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 1_500))
        return { content: [{ type: 'text', text: 'built' }], details: undefined }
      }
    })
    let next = 0
    const { model, requests } = delegate(() => {
      next++
      return assistantReply([toolCallPart(`step_${next}`, next === 1 ? 'build' : 'note')], 'toolUse')
    })
    const { session } = await createTestSession({
      stream: model,
      // A cache lifetime Pi keeps warm (11 s, refreshed after 1 s) and a price that makes warming pay.
      model: {
        ...MODEL,
        promptCache: { short: 11 },
        cost: { input: 10_000, output: 0, cacheRead: 0, cacheWrite: 0 }
      },
      tools: [buildTool, noteTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    const parentId = session.sessionManager.getSessionId()
    expect(requests.filter((request) => request.sessionId !== parentId)).toHaveLength(200)
    expect(toolResultOf(session, 'call_a').details).toMatchObject({ outcome: 'limit_reached' })
  })
})
