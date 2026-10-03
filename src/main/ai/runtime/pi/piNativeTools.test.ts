import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type AssistantMessage
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent
} from '@earendil-works/pi-coding-agent'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { expect, it } from 'vitest'

import { createPiApprovalExtension } from './approvalExtension'
import { createPiMcpExtension } from './piMcpExtension'
import { PiStreamAdapter } from './piStreamAdapter'

// Real SDK session + MCP wire + QuickJS: catches bypassed nested policy and lost structured results.
it('runs native Code Mode through MCP and blocks forbidden nested calls', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cherry-pi-native-'))
  const calls: string[] = []
  const events: AgentSessionEvent[] = []
  const chunks: unknown[] = []
  const adapter = new PiStreamAdapter({ enqueue: (chunk) => chunks.push(chunk) })
  const server = new McpServer({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ['read_value', 'forbidden'].map((name) => ({
      name,
      description: name,
      inputSchema: { type: 'object' as const }
    }))
  }))
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    calls.push(request.params.name)
    return { content: [{ type: 'text', text: 'value' }], structuredContent: { value: 42 } }
  })
  const pi = await import('@earendil-works/pi-coding-agent')
  const settingsManager = SettingsManager.inMemory(
    { retry: { enabled: false }, compaction: { enabled: false } },
    { projectTrusted: true }
  )
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  let turn = 0
  const streamSimple = () => {
    const message: AssistantMessage = {
      role: 'assistant',
      api: 'openai-completions',
      provider: 'fixture',
      model: 'fixture',
      timestamp: Date.now(),
      content:
        turn++ === 0
          ? [
              {
                type: 'toolCall',
                id: 'script',
                name: 'codemode',
                arguments: {
                  code: 'const result = await tools.mcp__fixture__read_value({}); text(result.structuredContent.value); try { await tools.mcp__fixture__forbidden({}) } catch (e) { text(e.message) }'
                }
              }
            ]
          : [{ type: 'text', text: 'done' }],
      stopReason: turn === 1 ? 'toolUse' : 'stop',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    }
    const stream = createAssistantMessageEventStream()
    stream.push({ type: 'start', partial: message })
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message })
    stream.end()
    return stream
  }
  modelRuntime.registerProvider('fixture', {
    streamSimple,
    api: 'openai-completions',
    apiKey: 'fixture',
    baseUrl: 'https://example.invalid',
    models: [
      {
        id: 'fixture',
        name: 'fixture',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 10000,
        maxTokens: 1000
      }
    ]
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      createCodemodeExtension({ models: false }),
      createToolSearchExtension(),
      createPiMcpExtension(pi, { fixture: { name: 'fixture', instance: server } }),
      createPiApprovalExtension({
        sessionId: 'fixture',
        workspacePath: cwd,
        agentDataPath: cwd,
        additionalReadOnlyRoots: [],
        emit: () => {
          throw new Error('Disabled tools must not request approval')
        },
        getInteractionState: () => ({ userResponse: 'unavailable' }),
        getPermissionMode: () => 'bypassPermissions',
        isDisabled: (name) => name === 'mcp__fixture__forbidden',
        autoApprovedTools: new Set(),
        approvalRequiredTools: new Set(),
        nonBypassableApprovalTools: new Set()
      })
    ]
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    modelRuntime,
    model: modelRuntime.getModel('fixture', 'fixture'),
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd)
  })
  session.subscribe((event) => {
    events.push(event)
    adapter.handleEvent(event)
  })
  try {
    await session.bindExtensions({})
    await session.prompt('Run the native tools')
    await mkdir('.context/cherry-electron-dev', { recursive: true })
    await writeFile('.context/cherry-electron-dev/pi-native-events.json', JSON.stringify({ events, chunks }, null, 2))
    expect(calls).toEqual(['read_value'])
    const output = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'codemode')
    expect(JSON.stringify(output)).toContain('42')
    expect(JSON.stringify(output)).toContain('disabled for this agent')
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'tool-output-available',
        toolCallId: 'script',
        output: expect.stringContaining('42')
      })
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'tool-output-available', toolCallId: 'script/1', output: { value: 42 } })
    )
    expect(
      events.some((event) => event.type === 'tool_execution_start' && event.toolName === 'mcp__fixture__read_value')
    ).toBe(true)
  } finally {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
    await rm(cwd, { recursive: true, force: true })
  }
})
