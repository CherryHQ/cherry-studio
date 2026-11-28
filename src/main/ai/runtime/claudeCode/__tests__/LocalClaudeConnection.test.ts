import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ClaudeObservation,
  ClaudeObservationSink,
  ClaudeThreadHandle
} from '@cherrystudio/agent-runtime-claude-code'
import type * as ClaudeRuntimeModule from '@cherrystudio/agent-runtime-claude-code'
import { createClaudeCodeRuntime } from '@cherrystudio/agent-runtime-claude-code'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentProviderService } from '@data/services/AgentProviderService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { LocalPermissionOptionsSchema, type LocalAgentConfiguration } from '@shared/ai/localAgent'

import { acquireLocalAgentBrowserLease } from '../../../mcp/localAgentBrowserBridge'
import type * as BrowserBridgeModule from '../../../mcp/localAgentBrowserBridge'
import { localLaunch } from '../../__tests__/fixtures/localLaunch'
import type { AgentRuntimeEvent } from '../../types'
import { LocalClaudeConnection } from '../LocalClaudeConnection'
import type * as ClaudeLaunchModule from '../localClaudeLaunch'
import { resolveClaudeLaunch } from '../localClaudeLaunch'

vi.mock('@cherrystudio/agent-runtime-claude-code', async (load) => ({
  ...(await load<typeof ClaudeRuntimeModule>()),
  createClaudeCodeRuntime: vi.fn()
}))

vi.mock('../localClaudeLaunch', async (load) => ({
  ...(await load<typeof ClaudeLaunchModule>()),
  resolveClaudeLaunch: vi.fn()
}))

vi.mock('../../../mcp/localAgentBrowserBridge', async (load) => ({
  ...(await load<typeof BrowserBridgeModule>()),
  acquireLocalAgentBrowserLease: vi.fn()
}))

const db = setupTestDatabase()
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  MockApplicationUtils.resetServices()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function startLocalClaude(nativeModel = 'cherryin:anthropic/claude-haiku-4.5') {
  const workspaceId = randomUUID()
  const sessionId = randomUUID()
  const cwd = '/tmp/local-claude-test'
  db.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: cwd, orderKey: 'a0' })
    .run()
  db.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Claude', orderKey: 'a0' }).run()

  vi.mocked(resolveClaudeLaunch).mockResolvedValue({
    installation: { componentId: 'claude', path: '/usr/local/bin/claude', source: 'system' },
    cwd,
    args: ['--verbose'],
    env: {}
  })
  vi.mocked(acquireLocalAgentBrowserLease).mockResolvedValue(undefined)
  MockApplicationUtils.setService('ClaudeCodeProcessManager', { spawn: vi.fn() })

  let observationSink: ClaudeObservationSink | undefined
  let createdConfig: any
  const handle: ClaudeThreadHandle = {
    thread: { id: 'thread-1' as any, backendId: 'backend-1' as any },
    claude: {
      sessionId: 'claude-native-1',
      state: () => ({ active: false }),
      relation: () => undefined,
      openChild: vi.fn(),
      start: () => ({ status: 'confirmed', value: undefined }),
      supportedCommands: async () => ({ status: 'confirmed', value: [] }),
      supportedModels: async () => ({
        status: 'confirmed',
        value: [{ value: nativeModel, displayName: nativeModel, description: '' }]
      }),
      setEffort: async () => ({ status: 'confirmed', value: undefined }),
      setPermissionMode: async () => ({ status: 'confirmed', value: undefined }),
      archive: async () => ({
        status: 'confirmed',
        value: { content: [], legacy: {}, retracted: [] }
      }),
      stopTask: async () => ({ status: 'confirmed', value: undefined }),
      observe: async (sink) => {
        observationSink = sink
        return {
          status: 'confirmed',
          value: {
            drain: async () => {},
            stop: async () => {}
          }
        }
      }
    }
  } as unknown as ClaudeThreadHandle

  vi.mocked(createClaudeCodeRuntime).mockReturnValue({
    lookupInput: vi.fn(),
    settled: async () => {},
    shutdown: async () => {
      await observationSink?.({
        events: [{ type: 'closed', reason: 'shutdown' }],
        native: [],
        retracted: []
      })
      return { status: 'confirmed', value: undefined }
    },
    create: async (config) => {
      createdConfig = config
      return { status: 'confirmed', value: handle }
    },
    open: async () => ({ status: 'confirmed', value: handle })
  } as unknown as ReturnType<typeof createClaudeCodeRuntime>)

  const config: LocalAgentConfiguration = {
    presetId: 'claude',
    enabled: true,
    args: [],
    env: {},
    nativeModel
  }
  const agentId = randomUUID()
  db.db
    .insert(agentTable)
    .values({ id: agentId, type: 'local', name: 'Claude', instructions: '', orderKey: 'a0' })
    .run()
  const runtime = agentProviderService.setBindingTx(db.db, agentId, config)
  const launch = localLaunch(runtime, runtime.providerId)
  const connection = new LocalClaudeConnection(
    { sessionId, agentId, modelId: 'runtime:agent', localTarget: launch.target },
    launch.config
  )
  const events: AgentRuntimeEvent[] = []
  const drained = (async () => {
    for await (const event of connection.events) events.push(event)
  })()

  cleanups.push(async () => {
    await connection.close()
    await drained
  })

  await connection.start(cwd)

  return {
    connection,
    events,
    createdConfig,
    emitObservation: (obs: Partial<ClaudeObservation>) =>
      observationSink!({
        events: [],
        native: [],
        retracted: [],
        ...obs
      })
  }
}

describe('LocalClaudeConnection', () => {
  it('emits unified decision options in canUseTool and caches session grants', async () => {
    const { events, createdConfig } = await startLocalClaude()
    const canUseTool = createdConfig.canUseTool
    const signal = new AbortController().signal

    const firstPrompt = canUseTool(
      'Bash',
      { command: 'ls' },
      {
        toolUseID: 'call-1',
        signal,
        suggestions: [
          { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'userSettings' }
        ]
      }
    )

    const approval = await vi.waitFor(() => {
      const found = events.find((e) => e.type === 'tool-approval-request' && e.request.toolCallId === 'call-1')
      if (found?.type !== 'tool-approval-request') throw new Error('Waiting for Bash approval')
      return found
    })
    const parsed = LocalPermissionOptionsSchema.parse(approval.request.input)
    expect(parsed.localPermissionOptions).toEqual([
      { optionId: 'allow', decision: 'accept', label: 'allow', name: 'Allow' },
      { optionId: 'allow_session', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' },
      { optionId: 'deny', decision: 'decline', label: 'deny', name: 'Deny' }
    ])

    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'allow_session' }
    })

    await expect(firstPrompt).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { command: 'ls' },
      updatedPermissions: [{ destination: 'session' }]
    })

    // Second call for the same tool name skips prompting in the same session.
    await expect(canUseTool('Bash', { command: 'pwd' }, { toolUseID: 'call-2', signal })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { command: 'pwd' }
    })

    // Denying another tool returns deny behavior.
    const editPrompt = canUseTool('Write', { file_path: 'a.txt' }, { toolUseID: 'call-3', signal })
    const editApproval = await vi.waitFor(() => {
      const found = events.find((e) => e.type === 'tool-approval-request' && e.request.toolCallId === 'call-3')
      if (found?.type !== 'tool-approval-request') throw new Error('Waiting for Write approval')
      return found
    })
    toolApprovalRegistry.dispatch(editApproval.request.approvalId, {
      approved: false,
      reason: 'User declined'
    })
    await expect(editPrompt).resolves.toEqual({ behavior: 'deny', message: 'User declined' })
  })

  it('reports native turn usage without treating the result as a context reading', async () => {
    const { events, emitObservation } = await startLocalClaude()

    await emitObservation({
      native: [
        {
          source: 'live',
          message: {
            type: 'result',
            subtype: 'success',
            uuid: 'msg-local-cmd',
            session_id: 'claude-native-1',
            local_command: true,
            usage: { input_tokens: 99, output_tokens: 1 },
            modelUsage: { 'cherryin:anthropic/claude-haiku-4.5': { contextWindow: 200_000 } }
          } as any
        },
        {
          source: 'live',
          message: {
            type: 'result',
            subtype: 'success',
            uuid: 'msg-real-turn',
            session_id: 'claude-native-1',
            is_error: false,
            result: 'ok',
            usage: {
              input_tokens: 3,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 200,
              output_tokens: 45
            },
            modelUsage: {
              'cherryin:anthropic/claude-haiku-4.5': { contextWindow: 200_000 }
            }
          } as any
        }
      ]
    })

    await vi.waitFor(() => expect(events.filter((e) => e.type === 'local-turn-usage')).toHaveLength(1))

    expect(events.filter((e) => e.type === 'local-turn-usage')).toEqual([
      {
        type: 'local-turn-usage',
        summary: expect.objectContaining({
          nativeSessionId: 'claude-native-1',
          model: 'cherryin:anthropic/claude-haiku-4.5',
          correlation: 'unknown',
          usage: {
            inputTokens: 1203,
            outputTokens: 45,
            totalTokens: 1248,
            noCacheTokens: 3,
            cacheReadTokens: 1000,
            cacheWriteTokens: 200
          }
        })
      }
    ])

    expect(events.filter((e) => e.type === 'context-usage')).toEqual([])
  })
})
