import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { type AskUserPort, createAskUserExtension, type ToolOutputStore } from '../src'
import {
  noteTool,
  outputText,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  toolCallPart,
  toolResultOf,
  toolResults
} from './subagentSupport'
import { createTestSession, finish, hostStore, scriptedModel, streamTextPort, textParts } from './support'

const DELEGATE_A = 'Delegate the check of module A'
const TASK_A = { description: 'Check module A', prompt: 'TASK-A: inspect module A' }

/** Parent delegates TASK-A once; the subagent writes a note, then reports. */
function delegateOnce(report: string[] = ['REPORT-A']) {
  return routedModel(({ userText, lastRole }) => {
    if (userText.includes('TASK-A'))
      return lastRole === 'user'
        ? [toolCallPart('note_1', 'note'), finish('tool-calls', 100, 20)]
        : [...textParts('r', ...report), finish('stop', 200, 40)]
    return lastRole === 'user'
      ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
      : [...textParts('d', 'Done'), finish('stop')]
  })
}

describe('subagent', () => {
  it('runs a fresh subagent in its own context and returns its final message, session id and usage', async () => {
    const { model, calls } = delegateOnce()
    const host = recordingSubagentPort()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port
    })

    await session.prompt(DELEGATE_A)

    expect(calls[0].options.tools?.map((tool) => tool.name)).toContain('subagent')
    const first = calls.find((call) => call.userText.includes('TASK-A'))!
    expect(first.options.prompt.map((message) => message.role)).toEqual(['system', 'user'])
    expect(first.userText).not.toContain(DELEGATE_A)
    expect(first.options.tools?.map((tool) => tool.name)).not.toContain('subagent')
    expect(toolResults(calls.at(-1)!).map((part) => outputText(part.output))).toEqual(['REPORT-A'])

    const result = toolResultOf(session, 'call_a')
    expect(result.isError).toBe(false)
    expect(result.details).toEqual({ sessionId: host.subagents[0].sessionId, fork: false, outcome: 'completed' })
    // Two replies: 100 + 20 + 2 cached and 200 + 40 + 2 cached tokens.
    expect(result.usage?.totalTokens).toBe(364)
    expect(result.usage?.cost.total).toBeCloseTo(0.0004204, 10)
  })

  it('offers subagent only when the host passes a subagent port', async () => {
    const { model, calls } = scriptedModel([[...textParts('a', 'Hi'), finish('stop')]])
    const { session } = await createTestSession({ port: streamTextPort(model).port })

    await session.prompt('Hello')

    expect(calls[0].tools?.map((tool) => tool.name) ?? []).not.toContain('subagent')
  })

  it('sends subagent entries only to its own listener; the parent transcript gains only the call and its result', async () => {
    const { model } = delegateOnce()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port,
      onEvent: parent.onEvent
    })

    await session.prompt(DELEGATE_A)

    const roles = (entries: typeof parent.entries) =>
      entries.map((entry) => (entry.kind === 'message' ? entry.message.role : entry.kind))
    expect(roles(parent.entries)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(JSON.stringify(parent.entries)).not.toContain('noted')
    const childEvents = host.events.get(host.subagents[0].sessionId)!
    const childEntries = childEvents.flatMap((event) => (event.type === 'transcript-append' ? event.entries : []))
    expect(roles(childEntries)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(childEvents.at(-1)).toMatchObject({ type: 'turn-complete', aborted: false })
  })

  it('hands the subagent session to the host before its first model request', async () => {
    const { model, calls } = delegateOnce()
    const seen: { sessionId: string; requestsBefore: number }[] = []
    const host = recordingSubagentPort(() => ({
      onSessionCreated: (child) =>
        seen.push({
          sessionId: child.sessionId,
          requestsBefore: calls.filter((call) => call.userText.includes('TASK-A')).length
        })
    }))
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port
    })

    await session.prompt(DELEGATE_A)

    expect(seen).toEqual([{ sessionId: host.subagents[0].sessionId, requestsBefore: 0 }])
  })

  it('runs host before_agent_start handlers inside the subagent', async () => {
    const { model, calls } = delegateOnce()
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('before_agent_start', () => ({
            message: { customType: 'cherry.test-note', content: 'NOTE-FOR-SUBAGENT', display: false }
          }))
        }
      ]
    }))
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port
    })

    await session.prompt(DELEGATE_A)

    expect(calls.find((call) => call.userText.includes('TASK-A'))!.userText).toContain('NOTE-FOR-SUBAGENT')
  })

  it('runs the subagent calls of one step at the same time', async () => {
    let active = 0
    let maxActive = 0
    const waitTool = defineTool({
      name: 'wait',
      label: 'Wait',
      description: 'Wait a moment',
      parameters: Type.Object({}),
      async execute() {
        maxActive = Math.max(maxActive, ++active)
        await new Promise((resolve) => setTimeout(resolve, 50))
        active--
        return { content: [{ type: 'text', text: 'waited' }], details: undefined }
      }
    })
    const { model } = routedModel(({ userText, lastRole }) => {
      for (const task of ['TASK-A', 'TASK-B'])
        if (userText.includes(task))
          return lastRole === 'user'
            ? [toolCallPart('wait_1', 'wait'), finish('tool-calls')]
            : [...textParts('r', `REPORT ${task}`), finish('stop')]
      return lastRole === 'user'
        ? [
            subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }),
            subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B' }),
            finish('tool-calls')
          ]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Check modules A and B')

    expect(maxActive).toBe(2)
  })

  it('tells the parent when the subagent ends without a final message', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return [finish('stop')]
      return lastRole === 'user'
        ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })

    await session.prompt(DELEGATE_A)

    const [result] = toolResults(calls.at(-1)!)
    expect(result.output.type).toBe('text')
    expect(outputText(result.output)).toMatch(/without a final message/)
  })

  it('offloads an oversized subagent report like any other tool result', async () => {
    const saved: { toolName: string }[] = []
    const store: ToolOutputStore = {
      async save(file) {
        saved.push({ toolName: file.toolName })
        return `/offload/${file.name}`
      }
    }
    const { model, calls } = delegateOnce(['R'.repeat(20_000)])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: recordingSubagentPort().port,
      offload: { store, thresholdChars: 5_000 }
    })

    await session.prompt(DELEGATE_A)

    expect(saved).toEqual([{ toolName: 'subagent' }])
    expect(outputText(toolResults(calls.at(-1)!)[0].output)).toContain('<persisted-output>')
  })

  it('rejects a call with an empty prompt without configuring a subagent', async () => {
    const { model, calls } = routedModel(({ lastRole }) =>
      lastRole === 'user'
        ? [subagentCall('call_a', { description: 'Check A', prompt: '   ' }), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    )
    const host = recordingSubagentPort()
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })

    await session.prompt(DELEGATE_A)

    expect(host.subagents).toEqual([])
    const [result] = toolResults(calls.at(-1)!)
    expect(result.output.type).toBe('error-text')
    expect(outputText(result.output)).toMatch(/non-empty description and prompt/)
  })

  // Breaks when two subagents of one parent can share a session id, or the host and the result disagree on it.
  it('gives every subagent its own session id, even when provider call ids collide', async () => {
    const check = (id: string) => subagentCall(id, { description: 'Check', prompt: `TASK ${id}` })
    const { model } = routedModel(({ userText, lastRole, options }) => {
      if (!options.tools?.some((tool) => tool.name === 'subagent')) return [...textParts('r', 'REPORT'), finish('stop')]
      if (lastRole !== 'user') return [...textParts('d', 'Done'), finish('stop')]
      const ids = userText.includes('Second prompt')
        ? ['call_a', 'call_a-2']
        : ['functions.subagent:0', 'functions.subagent-0', 'call_a']
      return [...ids.map(check), finish('tool-calls')]
    })
    const { port, requests } = streamTextPort(model)
    const host = recordingSubagentPort()
    const { session } = await createTestSession({ port, subagents: host.port })

    await session.prompt('First prompt')
    await session.prompt('Second prompt')

    const ids = host.subagents.map((subagent) => subagent.sessionId)
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    for (const id of ids) expect(id.startsWith(`${session.sessionId}.`)).toBe(true)
    expect(new Set(requests.map((request) => request.sessionId).filter((id) => id !== session.sessionId))).toEqual(
      new Set(ids)
    )

    const results = session.messages.flatMap((message) =>
      message.role === 'toolResult' && message.toolName === 'subagent'
        ? [{ toolCallId: message.toolCallId, details: message.details }]
        : []
    )
    const configured = host.subagents.map((subagent) => ({
      toolCallId: subagent.parentToolCallId,
      details: { sessionId: subagent.sessionId, fork: false, outcome: 'completed' }
    }))
    expect(results).toHaveLength(5)
    expect(results).toEqual(expect.arrayContaining(configured))
  })

  it('counts the usage of subagent replies a compaction folded away', async () => {
    const replies = [
      [toolCallPart('note_1', 'note'), finish('tool-calls', 100, 10)],
      [toolCallPart('note_2', 'note'), finish('tool-calls', 20_000, 20)],
      [...textParts('r', 'REPORT-A'), finish('stop', 100, 10)]
    ]
    let subagentRequests = 0
    const { model } = routedModel(({ lastRole, options }) => {
      // Only a subagent lacks the `subagent` tool; after compaction its task text is gone.
      if (!options.tools?.some((tool) => tool.name === 'subagent')) return replies[subagentRequests++]
      return lastRole === 'user'
        ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const host = recordingSubagentPort()
    const summarizedSessions: string[] = []
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port,
      // Threshold 32_000 - 16_384 tokens: the second reply crosses it and the compaction folds the first.
      compaction: {
        reserveTokens: 16_384,
        keepRecentTokens: 1,
        summarize: async ({ sessionId }) => {
          summarizedSessions.push(sessionId)
          return 'Summary of earlier work.'
        }
      }
    })

    await session.prompt(DELEGATE_A)

    expect(host.events.get(host.subagents[0].sessionId)!.filter((event) => event.type === 'compaction-end')).toEqual([
      { type: 'compaction-end', reason: 'threshold', entryId: expect.any(String) }
    ])
    const result = toolResultOf(session, 'call_a')
    expect(result.content).toEqual([{ type: 'text', text: 'REPORT-A' }])
    expect(result.usage?.totalTokens).toBe(112 + 20_022 + 112)
    expect(summarizedSessions).toEqual([host.subagents[0].sessionId])
    expect(summarizedSessions[0]).not.toBe(session.sessionId)
  })

  it('answers AskUserQuestion inside a subagent as unavailable without asking the host', async () => {
    const asked: unknown[] = []
    const askPort: AskUserPort = {
      async ask(request) {
        asked.push(request)
        return { status: 'answered', answers: {} }
      }
    }
    const question = {
      questions: [
        {
          question: 'Which file?',
          header: 'File',
          options: [
            { label: 'a.ts', description: 'File A' },
            { label: 'b.ts', description: 'File B' }
          ],
          multiSelect: false
        }
      ]
    }
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A'))
        return lastRole === 'user'
          ? [toolCallPart('ask_1', 'AskUserQuestion', question), finish('tool-calls')]
          : [...textParts('r', 'REPORT-A'), finish('stop')]
      return lastRole === 'user'
        ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const host = recordingSubagentPort(() => ({ extensionFactories: [createAskUserExtension(askPort)] }))
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      extensionFactories: [createAskUserExtension(askPort)]
    })

    await session.prompt(DELEGATE_A)

    expect(asked).toEqual([])
    const [answer] = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1])
    expect(answer.output.type).toBe('error-text')
    expect(outputText(answer.output)).toMatch(/No one can answer/)
  })
})
