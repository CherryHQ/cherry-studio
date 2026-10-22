import { existsSync, readFileSync } from 'node:fs'

import { Type } from '@earendil-works/pi-ai'
import {
  createToolSearchExtension,
  defineTool,
  type ExtensionFactory,
  SessionManager
} from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'

import { assistantReply, createTestSession, plain, scriptedModel, tempDir } from './sessionSupport'

it('reopens the native file with native reasoning, cost, custom state and edited context intact', async () => {
  const cwd = tempDir('persistent-cwd')
  const manager = SessionManager.create(cwd, tempDir('sessions'), { id: 'persistent-session' })
  const first = scriptedModel([
    assistantReply(
      [
        { type: 'thinking', thinking: 'remember the name' },
        { type: 'text', text: 'Hi Li.' }
      ],
      'stop',
      20,
      10
    )
  ])
  const earlier = await createTestSession({ cwd, sessionManager: manager, stream: first.model })
  await earlier.session.prompt('My name is Li.')
  const user = manager.getBranch().find((entry) => entry.type === 'message' && entry.message.role === 'user')!
  manager.appendCustomEntry('other.extension', { enabled: true })
  manager.appendContextEdit(user.id, { content: 'My name is Lin.' })
  await earlier.dispose()
  const file = manager.getSessionFile()!
  expect(existsSync(file)).toBe(true)
  const persisted = readFileSync(file, 'utf8')
  expect(JSON.parse(persisted.split('\n')[0])).toMatchObject({ type: 'session', id: 'persistent-session' })

  const opened = SessionManager.open(file)
  expect(opened.getSessionId()).toBe('persistent-session')
  const seen: unknown[] = []
  const observeStart: ExtensionFactory = (pi) => {
    pi.on('session_start', (_event, ctx) => {
      seen.push(...ctx.sessionManager.getBranch().filter((entry) => entry.type === 'custom'))
    })
  }
  const second = scriptedModel([assistantReply([{ type: 'text', text: 'Hello again.' }])])
  const restored = await createTestSession({
    cwd,
    sessionManager: opened,
    stream: second.model,
    extensionFactories: [observeStart]
  })
  expect(seen).toContainEqual(
    expect.objectContaining({ type: 'custom', customType: 'other.extension', data: { enabled: true } })
  )
  const reply = opened.getEntries().find((entry) => entry.type === 'message' && entry.message.role === 'assistant')
  expect(reply).toMatchObject({
    message: { usage: { input: 20, output: 10, cacheRead: 2, cost: { total: expect.closeTo(0.0000402, 12) } } }
  })
  await restored.session.prompt('Do you remember me?')
  const prompt = JSON.stringify(second.calls[0].messages)
  expect(prompt).toContain('My name is Lin.')
  expect(prompt).not.toContain('My name is Li.')
  expect(prompt).toContain('remember the name')
  expect(readFileSync(file, 'utf8').startsWith(persisted)).toBe(true)
})

it('restores activated tools beside newly enabled tools from native state', async () => {
  const cwd = tempDir('loadout-cwd')
  const manager = SessionManager.create(cwd, tempDir('loadout-sessions'))
  const weather = defineTool({
    name: 'get_weather',
    label: 'Weather',
    description: 'Weather forecast',
    parameters: Type.Object({}),
    exposure: 'deferred',
    execute: async () => ({ content: [{ type: 'text' as const, text: 'Sunny' }], details: {} })
  })
  const newTool = defineTool({
    name: 'host_new',
    label: 'New',
    description: 'Newly enabled tool',
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: 'text' as const, text: 'Done' }], details: {} })
  })
  const first = scriptedModel([
    assistantReply(
      [{ type: 'toolCall', id: 'search-1', name: 'tool_search', arguments: { query: 'weather forecast' } }],
      'toolUse'
    ),
    assistantReply([{ type: 'text', text: 'Loaded.' }])
  ])
  const earlier = await createTestSession({
    cwd,
    sessionManager: manager,
    stream: first.model,
    tools: [weather],
    builtinTools: ['tool_search'],
    extensionFactories: [createToolSearchExtension()]
  })
  await earlier.session.prompt('Find the weather tool')
  expect(first.calls[1].tools?.map((tool) => tool.name)).toContain('get_weather')
  await earlier.dispose()

  const second = scriptedModel([assistantReply([{ type: 'text', text: 'Ready.' }])])
  const restored = await createTestSession({
    cwd,
    sessionManager: SessionManager.open(manager.getSessionFile()!),
    stream: second.model,
    tools: [weather, newTool],
    builtinTools: ['tool_search'],
    extensionFactories: [createToolSearchExtension()]
  })
  await restored.session.prompt('Check the weather')
  expect(plain(second.calls[0].tools?.map((tool) => tool.name).sort())).toEqual([
    'get_weather',
    'host_new',
    'tool_search'
  ])
})

it('preserves image error results and tool usage without converting them to AI SDK storage', async () => {
  const cwd = tempDir('tool-state-cwd')
  const manager = SessionManager.create(cwd, tempDir('tool-state-sessions'))
  const reported = {
    input: 30,
    output: 7,
    cacheRead: 2,
    cacheWrite: 0,
    totalTokens: 39,
    cost: { input: 0.03, output: 0.07, cacheRead: 0.002, cacheWrite: 0, total: 0.102 }
  }
  manager.appendMessage({ role: 'user', content: 'Inspect the image', timestamp: 1 })
  manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'inspection',
    toolName: 'inspect',
    content: [
      { type: 'text', text: 'Image processing failed' },
      { type: 'image', data: 'AA==', mimeType: 'image/png' }
    ],
    details: { retryable: true },
    usage: reported,
    isError: true,
    timestamp: 2
  })
  const restored = await createTestSession({
    cwd,
    sessionManager: SessionManager.open(manager.getSessionFile()!),
    stream: scriptedModel([]).model
  })
  const result = restored.session.messages.find((message) => message.role === 'toolResult')
  expect(result).toMatchObject({
    role: 'toolResult',
    isError: true,
    details: { retryable: true },
    usage: { totalTokens: 39, cost: { total: 0.102 } },
    content: [
      { type: 'text', text: 'Image processing failed' },
      { type: 'image', data: 'AA==', mimeType: 'image/png' }
    ]
  })
})
