import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort } from '@cherrystudio/agent-runtime-pi'

import type { AiSdkModel } from './aiSdkModelBinding'
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
} from './aiSdkSubagentSupport'
import { createTestSession, finish, lastAssistant, MODEL, streamTextPort, textParts } from './aiSdkSupport'

const TASK_A = { description: 'Check A', prompt: 'TASK-A' }
const upstreamError = { type: 'error' as const, error: new Error('upstream exploded') }

/** Parent delegates TASK-A once; `child` scripts the subagent. */
function delegate(child: (lastRole: string) => LanguageModelV3StreamPart[]) {
  return routedModel(({ userText, lastRole }) => {
    if (userText.includes('TASK-A')) return child(lastRole)
    return lastRole === 'user'
      ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
      : [...textParts('d', 'Done'), finish('stop')]
  })
}

describe('subagent stops', () => {
  it('reports a failed subagent as an error with its partial output and usage', async () => {
    const { model } = delegate((lastRole) =>
      lastRole === 'user'
        ? [...textParts('p', 'PARTIAL-A'), toolCallPart('note_1', 'note'), finish('tool-calls', 100, 20)]
        : [upstreamError]
    )
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
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
    const { model } = delegate(() => [...textParts('h', 'HALF-A'), finish('length')])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
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
      if (userText.includes('TASK-A')) return [upstreamError]
      if (userText.includes('TASK-B')) return [...textParts('r', 'REPORT-B'), finish('stop')]
      return lastRole === 'user'
        ? [
            subagentCall('call_a', TASK_A),
            subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B' }),
            finish('tool-calls')
          ]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Check modules A and B')

    const [a, b] = toolResults(calls.at(-1)!)
    expect(a.output.type).toBe('error-text')
    expect(outputText(b.output)).toMatch(/^REPORT-B\n\n\(id: /)
  })

  it('stops the subagent and shuts it down when the parent turn aborts', async () => {
    const parent: { session?: AgentSession } = {}
    let shutdowns = 0
    const { model, calls } = delegate((lastRole) =>
      lastRole === 'user'
        ? [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
        : [...textParts('r', 'LATE'), finish('stop')]
    )
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('session_shutdown', () => void shutdowns++)
        }
      ]
    }))
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
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
    const { model, calls } = delegate(() => [...textParts('r', 'REPORT-A'), finish('stop')])
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
    const runtime = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    parent.session = runtime.session

    await runtime.session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(0)
    expect(toolResultOf(runtime.session, 'call_a').details).toMatchObject({ outcome: 'aborted' })
  })

  // Breaks when an abort made before Pi starts preparing the subagent's run (while its `input` handlers
  // run, which Pi ignores) is dropped: the subagent would still send its requests.
  it('does not let a subagent run when the turn aborts while its input handlers run', async () => {
    const parent: { session?: AgentSession } = {}
    const { model, calls } = delegate(() => [...textParts('r', 'REPORT-A'), finish('stop')])
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
    const runtime = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    parent.session = runtime.session

    await runtime.session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(0)
    expect(toolResultOf(runtime.session, 'call_a').details).toMatchObject({ outcome: 'aborted' })
  })

  it('does not start a subagent when the turn aborts before the host finishes configuring it', async () => {
    const parent: { session?: AgentSession } = {}
    const { model, calls } = delegate(() => [...textParts('r', 'REPORT-A'), finish('stop')])
    const host = recordingSubagentPort(async () => {
      void parent.session!.abort()
      await new Promise((resolve) => setTimeout(resolve, 0))
      return {}
    })
    const runtime = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
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
    const { model, calls } = delegate(() => [...textParts('r', 'REPORT-A'), finish('stop')])
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: port })

    await session.prompt('Delegate the check')

    const [result] = toolResults(calls.at(-1)!)
    expect(result.output.type).toBe('error-text')
    expect(outputText(result.output)).toContain('no workspace for subagents')
    expect(lastAssistant(session).stopReason).toBe('stop')
  })

  it('stops a subagent after 200 model requests', { timeout: 60_000 }, async () => {
    let next = 0
    const { model, calls } = delegate(() => [toolCallPart(`note_${++next}`, 'note'), finish('tool-calls')])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
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
    const sized = (unified: 'stop' | 'tool-calls', prompt: unknown): LanguageModelV3StreamPart => {
      const input = Math.ceil(JSON.stringify(prompt).length / 3.5)
      return {
        type: 'finish',
        usage: {
          inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: undefined }
        },
        finishReason: { unified, raw: unified }
      }
    }
    const { model } = routedModel(({ userText, lastRole, options }) => {
      // Pi's summary requests carry no tools.
      if ((options.tools ?? []).length === 0)
        return [...textParts('s', 'Summary: paging through TASK-A.'), sized('stop', options.prompt)]
      if (userText.includes('TASK-A'))
        return [toolCallPart(`page_${++next}`, 'fetch_page'), sized('tool-calls', options.prompt)]
      return lastRole === 'user'
        ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({
      port,
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
    const { model, calls } = delegate(() => [...textParts('r', 'AGAIN'), finish('stop')])
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('turn_end', () => {
            pi.sendUserMessage('Keep going', { deliverAs: 'followUp' })
          })
        }
      ]
    }))
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })

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
    const { model } = delegate(() => {
      next++
      return [toolCallPart(`step_${next}`, next === 1 ? 'build' : 'note'), finish('tool-calls')]
    })
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({
      port,
      // A cache lifetime Pi keeps warm (11 s, refreshed after 1 s) and a price that makes warming pay.
      model: {
        ...MODEL,
        promptCache: { short: 11 },
        cost: { input: 10_000, output: 0, cacheRead: 0, cacheWrite: 0 }
      } as AiSdkModel,
      tools: [buildTool, noteTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    const parentId = session.sessionManager.getSessionId()
    expect(requests.filter((request) => request.sessionId !== parentId)).toHaveLength(200)
    expect(toolResultOf(session, 'call_a').details).toMatchObject({ outcome: 'limit_reached' })
  })
})
