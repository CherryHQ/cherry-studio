import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type AssistantMessage
} from '@earendil-works/pi-ai'
import {
  createCodemodeExtension,
  createToolSearchExtension,
  ModelRuntime,
  SessionManager
} from '@earendil-works/pi-coding-agent'
import { Server } from '@modelcontextprotocol/server'
import { serveMcpTestServer } from '@test-helpers/mcp/client'
import { expect, it } from 'vitest'
import * as z from 'zod'

import { createScriptedHost } from '@cherrystudio/agent-behavior'
import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'
import { createPiRuntime } from '@cherrystudio/agent-runtime-pi'

import { readPiApprovalFacts } from './piApprovalFacts'
import { createPiMcpExtension, isPiToolDisabled } from './piMcpExtension'
import { PiMessageMetadata, resolvePiMcpToolMetadata } from './PiMessageMetadata'

// Real SDK session + MCP wire + QuickJS: catches bypassed nested policy and lost structured results.
it.each(['cherry-tools', 'my-server', 'my_server'])(
  'runs native MCP with binding %s and blocks forbidden nested calls',
  async (binding) => {
    const cherry = binding === 'cherry-tools'
    const shadowId = '87654321-4321-4321-8321-abcdef123456'
    const shadowName = binding === 'my-server' ? 'my_server' : 'my-server'
    const shadowPrefix = `mcp__${shadowId.replaceAll('-', '_')}__`
    const longTool = 'read_' + 'long_name_'.repeat(8)
    const serverId = cherry ? binding : '12345678-1234-4234-8234-123456789abc'
    const nativePrefix = `mcp__${serverId.replaceAll('-', '_')}__`
    const snapshots = new Map([[shadowName, { id: shadowId, name: shadowName }]])
    if (!cherry) snapshots.set(binding, { id: serverId, name: binding })
    const knowledgeReads = ['kb_search', 'kb_list', 'kb_read']
    const shadowTools = cherry ? knowledgeReads : ['forbidden']
    const disabled = new Set(cherry ? ['mcp__cherry-tools__kb_search'] : [`${nativePrefix}forbidden`])
    const cwd = await mkdtemp(join(tmpdir(), 'cherry-pi-native-'))
    const calls: string[] = []
    const events: ObservationPayload[] = []
    let resolveMetadata: (name: string) => ReturnType<typeof resolvePiMcpToolMetadata> = () => undefined
    const server = serveMcpTestServer(() => {
      const fixture = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
      fixture.setRequestHandler('tools/list', async () => ({
        tools: [
          'read_value',
          'forbidden',
          longTool,
          'report_artifacts',
          ...(cherry ? [...knowledgeReads, 'kb_manage'] : [])
        ].map((name) => ({
          name,
          description: name,
          inputSchema: { type: 'object' as const }
        }))
      }))
      fixture.setRequestHandler('tools/call', async (request) => {
        calls.push(request.params.name)
        return { content: [{ type: 'text', text: 'value' }], structuredContent: { value: 42 } }
      })
      return fixture
    })
    const shadow = serveMcpTestServer(() => {
      const fixture = new Server({ name: 'shadow', version: '1.0.0' }, { capabilities: { tools: {} } })
      fixture.setRequestHandler('tools/list', async () => ({
        tools: shadowTools.map((name) => ({ name, inputSchema: { type: 'object' as const } }))
      }))
      fixture.setRequestHandler('tools/call', async ({ params }) => {
        calls.push(`shadow:${params.name}`)
        return { content: [{ type: 'text', text: 'allowed on the other server' }] }
      })
      return fixture
    })
    const script = [
      `await tools.${nativePrefix}report_artifacts({artifacts:[{path:"/workspace/report.html"}]});`,
      `const result = await tools.${nativePrefix}read_value({}); text(result.structuredContent.value);`,
      `const long = await searchTools("${longTool}", { namespace: "mcp__${serverId.replaceAll('-', '_')}" }); await tools[long[0].name]({});`,
      ...shadowTools.map((name) => `await tools.${shadowPrefix}${name}({});`),
      ...(cherry ? [`await tools.${nativePrefix}kb_manage({});`] : []),
      ...(cherry ? knowledgeReads : ['forbidden']).map(
        (name) => `try { await tools.${nativePrefix}${name}({}) } catch (e) { text(e.message) }`
      )
    ].join('\n')
    const pi = await import('@earendil-works/pi-coding-agent')
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
                  arguments: { code: script }
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
    const host = createScriptedHost({
      settings: {
        goalDefaults: { maxGoalRounds: 1, maxGoalRoundsCeiling: 50, blockedAfter: 3 },
        autonomy: 'auto',
        permissionMode: 'bypassPermissions',
        attendance: 'unavailable',
        maxBackground: 4,
        offloadThreshold: 20000
      },
      modelKeys: { parentModelKey: 'fixture/fixture', defaultChildModelKey: 'fixture/fixture' }
    })
    host.approvals.facts = async (_call, tool) => {
      return readPiApprovalFacts(
        {
          sessionId: 'fixture',
          workspacePath: cwd,
          agentDataPath: cwd,
          additionalReadOnlyRoots: [],
          getInteractionState: () => ({ currentTurn: 'headless', userResponse: 'unavailable' }),
          getPermissionMode: () => 'bypassPermissions',
          isDisabled: (name) => isPiToolDisabled(disabled, name, resolveMetadata(name)),
          autoApprovedTools: new Set(),
          approvalRequiredTools: new Set(),
          nonBypassableApprovalTools: new Set(),
          delegationTools: new Set()
        },
        tool.name,
        z.record(z.string(), z.json()).parse(tool.args)
      )
    }
    function confirmed<T>(result: OperationResult<T>): T {
      if (result.status !== 'confirmed') throw new Error(result.error.message)
      return result.value
    }
    const runtime = confirmed(await createPiRuntime({ backendId: runtimeId('native-tools') }))
    const handle = confirmed(
      await runtime.create({
        cwd,
        agentDir: cwd,
        modelRuntime,
        model: modelRuntime.getModel('fixture', 'fixture')!,
        sessionManager: SessionManager.inMemory(cwd),
        behavior: { host, configureChild: () => ({}) },
        compaction: { enabled: false, reserveTokens: 1000, keepRecentTokens: 1000 },
        extensionFactories: [
          createCodemodeExtension({ models: false }),
          createToolSearchExtension(),
          createPiMcpExtension(
            pi,
            {
              fixture: { id: cherry ? undefined : serverId, name: binding, connect: server },
              shadow: { id: shadowId, name: shadowName, connect: shadow }
            },
            join(cwd, 'mcp.log')
          )
        ]
      })
    )
    resolveMetadata = (name) => resolvePiMcpToolMetadata(handle.pi.toolDefinition(name), snapshots)
    const observation = confirmed(
      await handle.observe((event) => {
        events.push(event)
      })
    )
    try {
      expect(
        await handle.input.submit({ inputId: runtimeId('tools'), text: 'Run the native tools', whenBusy: 'reject' })
      ).toMatchObject({ status: 'acknowledged' })
      await handle.pi.settled()
      await observation.drain()
      expect(events.filter((event) => event.type === 'input.changed').at(-1)?.input.outcome).toBe('completed')
      await mkdir('.context/cherry-electron-dev', { recursive: true })
      await writeFile(
        `.context/cherry-electron-dev/pi-native-${binding}-events.json`,
        JSON.stringify({ events }, null, 2)
      )
      expect(calls).toEqual([
        'report_artifacts',
        'read_value',
        longTool,
        ...shadowTools.map((name) => `shadow:${name}`),
        ...(cherry ? ['kb_manage'] : [])
      ])
      expect(resolveMetadata(`${nativePrefix}read_value`)).toEqual({
        type: 'mcp',
        serverId,
        serverName: binding,
        name: 'read_value'
      })
      const output = handle.pi
        .archive()
        .messages.flatMap((message) => message.parts)
        .find((part) => part.type === 'dynamic-tool' && part.toolCallId === 'script')
      expect(JSON.stringify(output)).toContain('42')
      expect(JSON.stringify(output)).toContain('disabled for this agent')
      if (output?.type !== 'dynamic-tool') throw new Error('Missing script result')
      const projected = new PiMessageMetadata(resolveMetadata).decorate({
        id: 'reply',
        role: 'assistant',
        parts: [output]
      })
      const artifacts = projected.parts.filter(
        (part) => part.type === 'dynamic-tool' && part.toolName.endsWith('__report_artifacts')
      )
      if (cherry) {
        expect(artifacts).toMatchObject([
          {
            state: 'output-available',
            input: { artifacts: [{ path: '/workspace/report.html' }] }
          }
        ])
      } else expect(artifacts).toEqual([])
    } finally {
      confirmed(await runtime.shutdown())
      await handle.release()
      await rm(cwd, { recursive: true, force: true })
    }
  }
)
