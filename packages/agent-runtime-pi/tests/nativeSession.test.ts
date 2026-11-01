import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  Type
} from '@earendil-works/pi-ai'
import { defineTool, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { expect, it, onTestFinished } from 'vitest'

import { createAgentRuntimeSession } from '../src'

it('runs native providers and tools without an AI SDK bridge and preserves the borrowed runtime on close', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'native-pi-'))
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  let receivedToolResult = false
  modelRuntime.registerProvider('native-test', {
    api: 'native-test',
    apiKey: 'unused',
    baseUrl: 'https://native-test.invalid',
    models: [
      {
        id: 'native-model',
        name: 'Native',
        reasoning: false,
        input: ['text'],
        contextWindow: 32000,
        maxTokens: 1024,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    streamSimple(model, context) {
      const toolResult = context.messages.findLast((message) => message.role === 'toolResult')
      receivedToolResult ||= toolResult?.content.some((part) => part.type === 'text' && part.text === 'Paris') ?? false
      const message: AssistantMessage = {
        role: 'assistant',
        provider: model.provider,
        model: model.id,
        api: model.api,
        content: toolResult
          ? [{ type: 'text', text: 'The city is Paris.' }]
          : [{ type: 'toolCall', id: 'city-1', name: 'city', arguments: {} }],
        stopReason: toolResult ? 'stop' : 'toolUse',
        timestamp: Date.now(),
        usage: {
          input: 10,
          output: 5,
          totalTokens: 15,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        }
      }
      const stream = createAssistantMessageEventStream()
      stream.push({ type: 'start', partial: message })
      stream.push({ type: 'done', reason: toolResult ? 'stop' : 'toolUse', message })
      stream.end()
      return stream
    }
  })
  const model = modelRuntime.getModel('native-test', 'native-model')!
  let executions = 0
  const options = {
    cwd,
    agentDir: cwd,
    modelRuntime,
    model,
    settings: { retry: { enabled: true } },
    tools: [
      defineTool({
        name: 'city',
        label: 'City',
        description: 'Get the city',
        parameters: Type.Object({}),
        execute: async () => {
          executions++
          return { content: [{ type: 'text' as const, text: 'Paris' }], details: {} }
        }
      })
    ]
  }
  const first = await createAgentRuntimeSession(options)
  onTestFinished(() => first.dispose())
  await first.session.prompt('Which city?')
  expect(first.session.messages.at(-1)).toMatchObject({
    role: 'assistant',
    content: [{ type: 'text', text: 'The city is Paris.' }]
  })
  expect(receivedToolResult).toBe(true)
  expect(executions).toBe(1)
  expect(first.session.settingsManager.getRetryEnabled()).toBe(true)
  await first.dispose()
  const second = await createAgentRuntimeSession(options)
  onTestFinished(() => second.dispose())
  await second.session.prompt('Which city again?')
  expect(second.session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' })
  expect(executions).toBe(2)
})
