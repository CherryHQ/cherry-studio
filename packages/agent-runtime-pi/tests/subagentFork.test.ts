import { Type } from '@earendil-works/pi-ai'
import { createToolSearchExtension, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  noteTool,
  outputText,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  toolCallPart,
  toolResults
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'

const forkA = { description: 'Check A', prompt: 'TASK-A', fork: true }
const forkB = { description: 'Check B', prompt: 'TASK-B', fork: true }

describe('subagent fork', () => {
  it('starts each fork from the parent conversation up to its call, every call of that step answered by one placeholder', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      for (const task of ['TASK-A', 'TASK-B'])
        if (userText.includes(task)) return [...textParts('r', `REPORT ${task}`), finish('stop')]
      return lastRole === 'user'
        ? [
            toolCallPart('note_1', 'note'),
            subagentCall('call_a', forkA),
            subagentCall('call_b', forkB),
            finish('tool-calls')
          ]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Check modules A and B')

    const promptA = calls.find((call) => call.userText.includes('TASK-A'))!.options.prompt
    const promptB = calls.find((call) => call.userText.includes('TASK-B'))!.options.prompt
    const parentAfterTools = calls.at(-1)!.options.prompt
    expect(parentAfterTools.slice(0, 3).map((message) => message.role)).toEqual(['system', 'user', 'assistant'])
    expect(promptA.slice(0, 3)).toEqual(parentAfterTools.slice(0, 3))
    expect(promptA.slice(0, -1)).toEqual(promptB.slice(0, -1))
    expect(promptA.at(-1)).not.toEqual(promptB.at(-1))
    const placeholders = promptA
      .flatMap((message) => (message.role === 'tool' ? message.content : []))
      .flatMap((part) => (part.type === 'tool-result' ? [part] : []))
    expect(placeholders.map((part) => part.toolCallId)).toEqual(['note_1', 'call_a', 'call_b'])
    expect(new Set(placeholders.map((part) => JSON.stringify(part.output))).size).toBe(1)
    expect(JSON.stringify(placeholders)).not.toContain('noted')
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
      if (userText.includes('TASK-A')) return [...textParts('r', 'REPORT-A'), finish('stop')]
      if (userText.includes('Delegate'))
        return lastRole === 'user'
          ? [subagentCall('call_a', forkA), finish('tool-calls')]
          : [...textParts('d', 'Done'), finish('stop')]
      return lastRole === 'user'
        ? [toolCallPart('search_1', 'tool_search', { query: 'weather forecast' }), finish('tool-calls')]
        : [...textParts('l', 'Loaded.'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
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
    expect(names(forkCall)).toEqual(expect.arrayContaining(['get_weather', 'subagent']))
  })

  it('rejects a subagent call made inside a fork', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A'))
        return lastRole === 'user'
          ? [subagentCall('call_nested', { description: 'Nested', prompt: 'TASK-NESTED' }), finish('tool-calls')]
          : [...textParts('r', 'REPORT-A'), finish('stop')]
      return lastRole === 'user'
        ? [subagentCall('call_a', forkA), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const host = recordingSubagentPort()
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })

    await session.prompt('Check module A')

    expect(host.subagents.map((subagent) => subagent.parentToolCallId)).toEqual(['call_a'])
    const nested = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1]).at(-1)!
    expect(nested.toolCallId).toBe('call_nested')
    expect(outputText(nested.output)).toMatch(/cannot start subagents/)
  })

  it('forks a session rebuilt from the host transcript with the replayed history', async () => {
    const earlier = routedModel(() => [...textParts('a', 'Noted.'), finish('stop')])
    const host = hostStore()
    const first = await createTestSession({ port: streamTextPort(earlier.model).port, onEvent: host.onEvent })
    await first.session.prompt('Remember the codename ORCHID')

    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return [...textParts('r', 'REPORT-A'), finish('stop')]
      return lastRole === 'user'
        ? [subagentCall('call_a', forkA), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      transcript: host.entries,
      subagents: recordingSubagentPort().port
    })
    await session.prompt('Delegate the check')

    expect(calls.find((call) => call.userText.includes('TASK-A'))!.userText).toContain('ORCHID')
  })
})
