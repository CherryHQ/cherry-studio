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
import { Server } from '@modelcontextprotocol/server'
import { serveMcpTestServer } from '@test-helpers/mcp/client'
import { expect, it } from 'vitest'

import { parseConvertedDocumentOutput } from '@shared/ai/documentConversionTool'

import { createPiApprovalExtension } from './approvalExtension'
import { createPiMcpExtension } from './piMcpExtension'
import { PiStreamAdapter, resolvePiMcpToolMetadata } from './piStreamAdapter'

// Real SDK session + MCP wire + QuickJS: catches bypassed nested policy and lost structured results.
it.each([
  ['cherry-tools', false],
  ['my-server', false],
  ['my_server', false],
  ['cherry-tools', true]
] as const)(
  'runs native MCP with binding %s (parent failure: %s) without losing child results',
  async (binding, parentFails) => {
    const shadowId = '87654321-4321-4321-8321-abcdef123456'
    const shadowName = binding === 'my-server' ? 'my_server' : 'my-server'
    const longTool = 'read_' + 'long_name_'.repeat(8)
    const serverId = binding === 'cherry-tools' ? binding : '12345678-1234-4234-8234-123456789abc'
    const nativePrefix = `mcp__${serverId.replaceAll('-', '_')}__`
    const snapshots = new Map(
      binding === 'cherry-tools'
        ? []
        : [
            [binding, { id: serverId, name: binding }],
            [shadowName, { id: shadowId, name: shadowName }]
          ]
    )
    const cwd = await mkdtemp(join(tmpdir(), 'cherry-pi-native-'))
    const calls: string[] = []
    const events: AgentSessionEvent[] = []
    const chunks: unknown[] = []
    let resolveMetadata: (name: string) => ReturnType<typeof resolvePiMcpToolMetadata> = () => undefined
    const adapter = new PiStreamAdapter({ enqueue: (chunk) => chunks.push(chunk) }, (name) => resolveMetadata(name))
    const server = serveMcpTestServer(() => {
      const fixture = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
      fixture.setRequestHandler('tools/list', async () => ({
        tools: ['read_value', 'forbidden', longTool, 'convert_to_document'].map((name) => ({
          name,
          description: name,
          inputSchema: { type: 'object' as const }
        }))
      }))
      fixture.setRequestHandler('tools/call', async (request) => {
        calls.push(request.params.name)
        if (request.params.name === 'convert_to_document')
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  path: 'report.docx',
                  format: 'docx',
                  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                })
              }
            ]
          }
        return { content: [{ type: 'text', text: 'value' }], structuredContent: { value: 42 } }
      })
      return fixture
    })
    const shadow = serveMcpTestServer(() => {
      const fixture = new Server({ name: 'shadow', version: '1.0.0' }, { capabilities: { tools: {} } })
      fixture.setRequestHandler('tools/list', async () => ({
        tools: [{ name: 'forbidden', inputSchema: { type: 'object' as const } }]
      }))
      fixture.setRequestHandler('tools/call', async () => {
        calls.push('shadow:forbidden')
        return { content: [{ type: 'text', text: 'allowed on the other server' }] }
      })
      return fixture
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
                    code: parentFails
                      ? `await tools.${nativePrefix}convert_to_document({}); throw new Error('parent failed after saving')`
                      : `const result = await tools.${nativePrefix}read_value({}); text(result.structuredContent.value); const long = await searchTools("${longTool}", { namespace: "mcp__${serverId.replaceAll('-', '_')}" }); await tools[long[0].name]({}); ${binding === 'cherry-tools' ? '' : `await tools.mcp__${shadowId.replaceAll('-', '_')}__forbidden({});`} try { await tools.${nativePrefix}forbidden({}) } catch (e) { text(e.message) }`
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
        createPiMcpExtension(
          pi,
          {
            fixture: { id: binding === 'cherry-tools' ? undefined : serverId, name: binding, connect: server },
            ...(binding === 'cherry-tools' ? {} : { shadow: { id: shadowId, name: shadowName, connect: shadow } })
          },
          join(cwd, 'mcp.log')
        ),
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
          isDisabled: (name) => name === `${nativePrefix}forbidden`,
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
    resolveMetadata = (name) => resolvePiMcpToolMetadata(session.getToolDefinition(name), snapshots)
    try {
      await session.bindExtensions({})
      await session.prompt('Run the native tools')
      await mkdir('.context/cherry-electron-dev', { recursive: true })
      await writeFile(
        `.context/cherry-electron-dev/pi-native-${binding}${parentFails ? '-parent-failure' : ''}-events.json`,
        JSON.stringify({ events, chunks }, null, 2)
      )
      if (parentFails) {
        expect(calls).toEqual(['convert_to_document'])
        const child = chunks.find(
          (chunk) =>
            typeof chunk === 'object' &&
            chunk !== null &&
            'toolCallId' in chunk &&
            chunk.toolCallId === 'script/1' &&
            'output' in chunk
        )
        expect(child).toMatchObject({ type: 'tool-output-available', toolCallId: 'script/1' })
        const receipt =
          child && typeof child === 'object' && 'output' in child ? parseConvertedDocumentOutput(child.output) : null
        expect(receipt).toMatchObject({ path: 'report.docx', format: 'docx' })
        expect(chunks).toContainEqual(
          expect.objectContaining({
            type: 'tool-output-error',
            toolCallId: 'script',
            errorText: expect.stringContaining('parent failed after saving')
          })
        )
        return
      }
      expect(calls).toEqual(['read_value', longTool, ...(binding === 'cherry-tools' ? [] : ['shadow:forbidden'])])
      expect(chunks).toContainEqual(
        expect.objectContaining({
          type: 'tool-input-available',
          toolName: expect.any(String),
          providerMetadata: expect.objectContaining({
            cherry: expect.objectContaining({
              tool: { type: 'mcp', serverId, serverName: binding, name: longTool }
            })
          })
        })
      )
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
        expect.objectContaining({
          type: 'tool-output-available',
          toolCallId: 'script/1',
          output: { value: 42 },
          providerMetadata: expect.objectContaining({
            cherry: expect.objectContaining({
              tool: expect.objectContaining({ serverId, serverName: binding, name: 'read_value' })
            })
          })
        })
      )
      expect(
        events.some((event) => event.type === 'tool_execution_start' && event.toolName === `${nativePrefix}read_value`)
      ).toBe(true)
    } finally {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
      session.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  }
)
