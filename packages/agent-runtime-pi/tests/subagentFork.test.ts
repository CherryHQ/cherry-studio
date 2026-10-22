import { Type } from '@earendil-works/pi-ai'
import { createToolSearchExtension, defineTool, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { assistantReply, createTestSession, hostStore, plain, tempDir } from './sessionSupport'
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

const forkA = { description: 'Check A', prompt: 'TASK-A', fork: true }
const forkB = { description: 'Check B', prompt: 'TASK-B', fork: true }

describe('subagent fork', () => {
  it.each([false, true])(
    'forks an identical native prefix without changing the parent branch (persistent: %s)',
    async (persistent) => {
      const { model, calls } = routedModel(({ userText, lastRole }) => {
        for (const task of ['TASK-A', 'TASK-B'])
          if (userText.includes(task)) return assistantReply([{ type: 'text', text: `REPORT ${task}` }])
        return lastRole === 'user'
          ? assistantReply(
              [toolCallPart('note_1', 'note'), subagentCall('call_a', forkA), subagentCall('call_b', forkB)],
              'toolUse'
            )
          : assistantReply([{ type: 'text', text: 'Done' }])
      })
      const host = recordingSubagentPort()
      const cwd = tempDir('parent')
      const manager = persistent ? SessionManager.create(cwd, tempDir('children')) : SessionManager.inMemory(cwd)
      const { session } = await createTestSession({
        cwd,
        sessionManager: manager,
        stream: model,
        tools: [noteTool],
        subagents: host.port
      })

      await session.prompt('Check modules A and B')

      const promptA = calls.find((call) => call.userText.includes('TASK-A'))!.options.messages
      const promptB = calls.find((call) => call.userText.includes('TASK-B'))!.options.messages
      const parentAfterTools = calls.at(-1)!.options.messages
      expect(parentAfterTools.slice(0, 3).map((message) => message.role)).toEqual(['system', 'user', 'assistant'])
      expect(promptA.slice(0, 3)).toEqual(parentAfterTools.slice(0, 3))
      expect(promptA.slice(0, -1)).toEqual(promptB.slice(0, -1))
      expect(promptA.at(-1)).not.toEqual(promptB.at(-1))
      const placeholders = promptA.filter((message) => message.role === 'toolResult')
      expect(placeholders.map((part) => part.toolCallId)).toEqual(['note_1', 'call_a', 'call_b'])
      expect(new Set(placeholders.map((part) => JSON.stringify(part.content))).size).toBe(1)
      // Pi answers calls left without a result with its own error result; these must be the package's.
      expect(placeholders[0].content[0].type).toBe('text')
      expect(outputText(placeholders[0].content)).toMatch(/still running/)
      expect(JSON.stringify(placeholders)).not.toContain('noted')
      expect(host.subagents.map((subagent) => subagent.fork)).toEqual([true, true])
      expect(toolResultOf(session, 'call_a').details).toMatchObject({ fork: true })
      expect(session.sessionManager).toBe(manager)
      for (const child of host.subagents) {
        const childManager = host.sessions.get(child.sessionId)!.sessionManager
        expect(childManager.getSessionId()).toBe(child.sessionId)
        expect(childManager.isPersisted()).toBe(persistent)
        if (persistent) {
          const reopened = SessionManager.open(childManager.getSessionFile()!)
          expect(reopened.getHeader()).toMatchObject({ id: child.sessionId, parentSession: manager.getSessionFile() })
          expect(reopened.getBranch().at(-1)).toMatchObject({
            type: 'message',
            message: { role: 'assistant', stopReason: 'stop' }
          })
        }
      }
    }
  )

  it('forks from the latest assistant message holding the call when an earlier turn reused its id', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-TWO')) return assistantReply([{ type: 'text', text: 'REPORT-TWO' }])
      if (userText.includes('TASK-ONE')) return assistantReply([{ type: 'text', text: 'REPORT-ONE' }])
      if (lastRole !== 'user') return assistantReply([{ type: 'text', text: 'Done' }])
      return userText.includes('Second prompt')
        ? assistantReply([subagentCall('call_a', { description: 'Two', prompt: 'TASK-TWO', fork: true })], 'toolUse')
        : assistantReply([subagentCall('call_a', { description: 'One', prompt: 'TASK-ONE' })], 'toolUse')
    })
    const { session } = await createTestSession({
      stream: model,
      subagents: recordingSubagentPort().port
    })

    await session.prompt('First prompt')
    await session.prompt('Second prompt')

    const fork = calls.find((call) => call.userText.includes('TASK-TWO'))!
    expect(fork.userText).toContain('First prompt')
    expect(fork.userText).toContain('Second prompt')
    const lastAssistant = fork.options.messages.findLast((message) => message.role === 'assistant')!
    expect(lastAssistant.content).toEqual([
      expect.objectContaining({
        type: 'toolCall',
        id: 'call_a',
        arguments: expect.objectContaining({ prompt: 'TASK-TWO' })
      })
    ])
  })

  it('gives a fork the tools of the parent, including tools that tool_search activated', async () => {
    const weather = defineTool({
      name: 'get_weather',
      label: 'Weather',
      description: 'Get the weather forecast for a city',
      parameters: Type.Object({ city: Type.String() }),
      exposure: 'deferred',
      async execute() {
        return { content: [{ type: 'text', text: 'Sunny' }], details: undefined }
      }
    })
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return assistantReply([{ type: 'text', text: 'REPORT-A' }])
      if (userText.includes('Delegate'))
        return lastRole === 'user'
          ? assistantReply([subagentCall('call_a', forkA)], 'toolUse')
          : assistantReply([{ type: 'text', text: 'Done' }])
      return lastRole === 'user'
        ? assistantReply([toolCallPart('search_1', 'tool_search', { query: 'weather forecast' })], 'toolUse')
        : assistantReply([{ type: 'text', text: 'Loaded.' }])
    })
    const { session } = await createTestSession({
      stream: model,
      tools: [weather],
      builtinTools: ['tool_search'],
      extensionFactories: [createToolSearchExtension()],
      subagents: recordingSubagentPort(() => ({ extensionFactories: [createToolSearchExtension()] })).port
    })

    await session.prompt('Find a weather tool')
    await session.prompt('Delegate the forecast check')

    const parentCall = calls.find((call) => call.userText.includes('Delegate') && call.lastRole === 'user')!
    const forkCall = calls.find((call) => call.userText.includes('TASK-A'))!
    const names = (call: typeof forkCall) => call.options.tools?.map((tool) => tool.name)
    expect(names(forkCall)).toEqual(names(parentCall))
    expect(names(forkCall)).toEqual(expect.arrayContaining(['get_weather', 'subagent', 'message_subagent']))
  })

  // Breaks when a fork can start or address subagents (it would manage its parent's subagents).
  it('rejects subagent, message_subagent and stop_subagent calls made inside a fork', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A'))
        return lastRole === 'user'
          ? assistantReply(
              [
                subagentCall('call_nested', { description: 'Nested', prompt: 'TASK-NESTED' }),
                toolCallPart('call_message', 'message_subagent', { id: 'any', message: 'hello' }),
                toolCallPart('call_stop', 'stop_subagent', { id: 'any' })
              ],
              'toolUse'
            )
          : assistantReply([{ type: 'text', text: 'REPORT-A' }])
      return lastRole === 'user'
        ? assistantReply([subagentCall('call_a', forkA)], 'toolUse')
        : assistantReply([{ type: 'text', text: 'Done' }])
    })
    const host = recordingSubagentPort()
    const { session } = await createTestSession({ stream: model, subagents: host.port })

    await session.prompt('Check module A')

    expect(host.subagents.map((subagent) => subagent.parentToolCallId)).toEqual(['call_a'])
    const refused = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1]).slice(-3)
    expect(refused.map((part) => [part.toolCallId, outputText(part.content)])).toEqual([
      ['call_nested', 'Subagents cannot start or manage subagents.'],
      ['call_message', 'Subagents cannot start or manage subagents.'],
      ['call_stop', 'Subagents cannot start or manage subagents.']
    ])
  })

  // Reopening a child must preserve the conversation it was forked from.
  it('restores the forked prefix from the child native branch', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return assistantReply([{ type: 'text', text: 'REPORT-A' }])
      return lastRole === 'user'
        ? assistantReply([subagentCall('call_a', forkA)], 'toolUse')
        : assistantReply([{ type: 'text', text: 'Done' }])
    })
    const host = recordingSubagentPort()
    const { session } = await createTestSession({ stream: model, subagents: host.port })
    await session.prompt('Check module A with the codename ORCHID')

    const stored = host.sessions.get(host.subagents[0].sessionId)!.sessionManager.getBranch()
    const rebuilt = await createTestSession({ stream: model, entries: plain(stored) })
    await rebuilt.session.prompt('FOLLOW-UP')

    const request = calls.at(-1)!
    expect(request.userText).toContain('ORCHID')
    expect(request.userText).toContain('TASK-A')
    expect(toolResults(request).map((part) => part.toolCallId)).toEqual(['call_a'])
    expect(outputText(toolResults(request)[0].content)).toMatch(/still running/)
  })

  it('forks a session rebuilt from the host transcript with the replayed history', async () => {
    const earlier = routedModel(() => assistantReply([{ type: 'text', text: 'Noted.' }]))
    const host = hostStore()
    const first = await createTestSession({ stream: earlier.model, onEvent: host.onEvent })
    await first.session.prompt('Remember the codename ORCHID')

    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return assistantReply([{ type: 'text', text: 'REPORT-A' }])
      return lastRole === 'user'
        ? assistantReply([subagentCall('call_a', forkA)], 'toolUse')
        : assistantReply([{ type: 'text', text: 'Done' }])
    })
    const { session } = await createTestSession({
      stream: model,
      entries: host.entries,
      subagents: recordingSubagentPort().port
    })
    await session.prompt('Delegate the check')

    expect(calls.find((call) => call.userText.includes('TASK-A'))!.userText).toContain('ORCHID')
  })
})
