import { randomUUID } from 'node:crypto'

import type { SDKMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'

import type { AgentRuntimeEvent, AgentRuntimeUserInput } from '../../types'
import { ClaudeConnection } from '../ClaudeConnection'
import { observedParts } from './observedParts'

vi.mock('../localContext', () => ({
  localContext: () => ({ id: 'local-context', backendId: 'local-backend' }),
  bindLocalContext: (id: string, nativeThreadId: string) => ({ id, backendId: 'local-backend', nativeThreadId })
}))

const sdk = vi.hoisted(() => ({
  messages: [] as SDKMessage[],
  openQueries: 0,
  returning: false,
  returnGate: undefined as Promise<void> | undefined,
  queryOptions: [] as Array<Record<string, unknown>>
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.openQueries++
    sdk.queryOptions.push(options)
    let closed = false
    return {
      supportedCommands: async () => [],
      supportedModels: async () => [],
      close() {
        if (!closed) {
          closed = true
          sdk.openQueries--
        }
      },
      async *[Symbol.asyncIterator]() {
        try {
          yield* sdk.messages
        } finally {
          sdk.returning = true
          await sdk.returnGate
        }
      }
    }
  }
}))
vi.mock('../launch', () => ({ resolveLocalAgentLaunch: async () => ({ executable: 'claude', args: [], env: {} }) }))

const input = { message: { data: { parts: [{ type: 'text', text: 'hello' }] } } } as AgentRuntimeUserInput

function result(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'native-session',
    usage: { input_tokens: 3, output_tokens: 5 },
    stop_reason: 'end_turn',
    ...overrides
  } as SDKMessage
}

function stream(event: SDKPartialAssistantMessage['event'], parent: string | null = null): SDKPartialAssistantMessage {
  return { type: 'stream_event', parent_tool_use_id: parent, event, session_id: 'native-session', uuid: randomUUID() }
}

async function run(headless = false) {
  const connection = new ClaudeConnection(
    'session',
    'agent',
    {
      protocol: 'claude',
      enabled: true,
      args: [],
      env: {}
    },
    headless
  )
  const events: AgentRuntimeEvent[] = []
  const drained = (async () => {
    for await (const event of connection.events) events.push(event)
  })()
  try {
    await connection.start('/tmp')
    await connection.send(input)
  } finally {
    await connection.close()
    await drained
  }
  return {
    events,
    info: connection.localSessionInfo,
    chunks: observedParts(events)
  }
}

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  sdk.openQueries = 0
  sdk.messages = []
  sdk.returning = false
  sdk.returnGate = undefined
  sdk.queryOptions = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('native Claude protocol mapping', () => {
  it('uses only read tools and no ambient settings or approval UI for scheduled turns', async () => {
    sdk.messages = [result()]
    await run(true)
    expect(sdk.queryOptions.at(-1)).toMatchObject({
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep'],
      settingSources: [],
      strictMcpConfig: true
    })
  })

  it('reports native permission denials in a successful SDK result as a scheduled execution failure', async () => {
    sdk.messages = [result({ permission_denials: [{ tool_name: 'Glob', tool_use_id: 'blocked', tool_input: {} }] })]
    const { events } = await run(true)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ providerErrorCategory: 'permission' })
      })
    )
  })

  it('does not allocate an SDK query after the connection closes during content preparation', async () => {
    const connection = new ClaudeConnection('session', 'agent', {
      protocol: 'claude',
      enabled: true,
      args: [],
      env: {}
    })
    await connection.start('/tmp')
    const sending = expect(connection.send(input)).rejects.toThrow('unavailable')
    await connection.close()
    await sending
    expect(sdk.openQueries).toBe(0)
  })

  it('admits the next turn only after the previous SDK iterator has closed', async () => {
    sdk.messages = [result()]
    let release!: () => void
    sdk.returnGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const connection = new ClaudeConnection('session', 'agent', {
      protocol: 'claude',
      enabled: true,
      args: [],
      env: {}
    })
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    try {
      await connection.start('/tmp')
      const first = connection.send(input)
      await vi.waitFor(() => expect(sdk.returning).toBe(true))
      expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(0)
      release()
      await first
      await connection.send(input)
      await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(2))
      expect(events.filter((event) => event.type === 'error')).toHaveLength(0)
    } finally {
      release()
      await connection.close()
      await drained
    }
  })

  it('preserves thinking and child tool ownership without stamping a provider model identity', async () => {
    sdk.messages = [
      stream({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' }
      }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check first' } }),
      stream({ type: 'content_block_stop', index: 0 }),
      stream(
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } },
        'parent-tool'
      ),
      stream(
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Child answer' } },
        'parent-tool'
      ),
      stream({ type: 'content_block_stop', index: 0 }, 'parent-tool'),
      {
        type: 'assistant',
        parent_tool_use_id: 'parent-tool',
        message: {
          model: 'child-model',
          content: [{ type: 'tool_use', id: 'child-tool', name: 'Read', input: { path: '/tmp/file' } }]
        }
      } as SDKMessage,
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { model: 'native-model', content: [{ type: 'text', text: 'Main answer' }] }
      } as SDKMessage,
      result()
    ]
    const { events, chunks, info } = await run()
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'append', kind: 'reasoning', text: 'Check first' }))
    const childText = chunks.find(
      (chunk) =>
        chunk.type === 'open' &&
        chunk.kind === 'text' &&
        chunk.providerMetadata?.['claude-code']?.parentToolCallId === 'parent-tool'
    )
    expect(childText).toBeDefined()
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'dynamic-tool',
        state: 'input-streaming',
        toolCallId: 'child-tool',
        callProviderMetadata: expect.objectContaining({
          'claude-code': expect.objectContaining({ parentToolCallId: 'parent-tool' })
        })
      })
    )
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'append', kind: 'text', text: 'Main answer' }))
    expect(info.activeModel).toEqual({ id: 'native-model' })

    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
    for (const chunk of events) {
      if (chunk.type === 'message-metadata') expect(chunk.messageMetadata).not.toHaveProperty('modelId')
    }
  })

  it('continues past a resumed task notification and emits the actual user turn answer', async () => {
    sdk.messages = [
      result({ origin: { kind: 'task-notification' } }),
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { model: 'native-model', content: [{ type: 'text', text: 'Actual answer' }] }
      } as SDKMessage,
      result({ stop_reason: 'max_tokens' })
    ]
    const { chunks, events } = await run()
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'append', kind: 'text', text: 'Actual answer' }))
    expect(events).toContainEqual({ type: 'turn-complete', finishReason: 'length' })
    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
    expect(events).toContainEqual({ type: 'resume-token', token: 'native-session' })
  })

  it('reports SDK terminal API failures even when is_error is false', async () => {
    sdk.messages = [result({ terminal_reason: 'api_error', api_error_status: 429, result: 'Rate limited' })]
    const { events } = await run()
    expect(events).toContainEqual({ type: 'error', error: expect.objectContaining({ message: 'Rate limited' }) })
    expect(events.some((event) => event.type === 'turn-complete')).toBe(false)
  })

  it('exposes builtin slash commands on start before the first turn', async () => {
    const connection = new ClaudeConnection('session', 'agent', {
      protocol: 'claude',
      enabled: true,
      args: [],
      env: {}
    })
    await connection.start('/tmp')
    const commands = await connection.getSupportedCommands()
    expect(commands?.map((cmd) => cmd.name)).toEqual(
      expect.arrayContaining(['clear', 'compact', 'context', 'usage', 'goal'])
    )
    await connection.close()
  })

  it('exposes native Claude modes, switches permissionMode across turns, and syncs init mode when unset', async () => {
    sdk.messages = [
      {
        type: 'system',
        subtype: 'init',
        permissionMode: 'acceptEdits',
        session_id: 'native-session',
        uuid: randomUUID()
      } as unknown as SDKMessage,
      result()
    ]
    const connection = new ClaudeConnection('session', 'agent', {
      protocol: 'claude',
      enabled: true,
      args: [],
      env: {}
    })
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()

    try {
      await connection.start('/tmp')
      expect(connection.localSessionInfo.mode).toMatchObject({
        id: 'claude-mode',
        currentValue: 'default'
      })
      expect(connection.localSessionInfo.mode?.options.map((option) => option.value)).toEqual([
        'default',
        'acceptEdits',
        'plan',
        'auto',
        'bypassPermissions'
      ])

      await connection.send(input)
      expect(sdk.queryOptions.at(-1)?.permissionMode).toBeUndefined()
      expect(connection.localSessionInfo.mode?.currentValue).toBe('acceptEdits')

      await expect(connection.setMode('claude-mode', 'invalid')).rejects.toThrow('no longer available')
      await expect(connection.setMode('wrong-id', 'plan')).rejects.toThrow('no longer available')

      await connection.setMode('claude-mode', 'plan')
      expect(connection.localSessionInfo.mode?.currentValue).toBe('plan')
      await connection.send(input)
      expect(sdk.queryOptions.at(-1)?.permissionMode).toBe('plan')
      expect(sdk.queryOptions.at(-1)?.allowDangerouslySkipPermissions).toBeUndefined()
      // User-selected override must not be overwritten by subsequent init messages.
      expect(connection.localSessionInfo.mode?.currentValue).toBe('plan')

      await connection.setMode('claude-mode', 'bypassPermissions')
      await connection.send(input)
      expect(sdk.queryOptions.at(-1)?.permissionMode).toBe('bypassPermissions')
      expect(sdk.queryOptions.at(-1)?.allowDangerouslySkipPermissions).toBe(true)
      expect(events.some((event) => event.type === 'local-session-info')).toBe(true)

      expect(connection.localSessionInfo.thoughtLevel).toMatchObject({
        id: 'claude-effort',
        currentValue: 'default'
      })
      expect(sdk.queryOptions.at(-1)?.effort).toBeUndefined()
      await expect(connection.setThoughtLevel('claude-effort', 'invalid')).rejects.toThrow('no longer available')
      await expect(connection.setThoughtLevel('wrong-id', 'high')).rejects.toThrow('no longer available')

      await connection.setThoughtLevel('claude-effort', 'high')
      expect(connection.localSessionInfo.thoughtLevel?.currentValue).toBe('high')
      await connection.send(input)
      expect(sdk.queryOptions.at(-1)?.effort).toBe('high')

      await connection.setThoughtLevel('claude-effort', 'default')
      await connection.send(input)
      expect(sdk.queryOptions.at(-1)?.effort).toBeUndefined()
    } finally {
      await connection.close()
      await drained
    }
  })

  it('auto-allows tools in bypassPermissions while still prompting for AskUserQuestion', async () => {
    sdk.messages = [result()]
    let release!: () => void
    sdk.returnGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const connection = new ClaudeConnection('session', 'agent', {
      protocol: 'claude',
      enabled: true,
      args: [],
      env: {}
    })
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    try {
      await connection.start('/tmp')
      await connection.setMode('claude-mode', 'bypassPermissions')
      const sending = connection.send(input)
      await vi.waitFor(() => expect(sdk.returning).toBe(true))

      const canUseTool = sdk.queryOptions.at(-1)?.canUseTool as (
        name: string,
        toolInput: Record<string, unknown>,
        opts: { toolUseID: string; signal: AbortSignal; suggestions?: Array<Record<string, unknown>> }
      ) => Promise<Record<string, unknown>>
      const controller = new AbortController()

      await expect(
        canUseTool('Bash', { command: 'pwd' }, { toolUseID: 'bash-1', signal: controller.signal })
      ).resolves.toEqual({ behavior: 'allow', updatedInput: { command: 'pwd' } })
      expect(events.some((event) => event.type === 'tool-approval-request')).toBe(false)

      const questionPromise = canUseTool(
        'AskUserQuestion',
        { questions: [{ id: 'q1', header: 'Choice', question: 'Proceed?' }] },
        { toolUseID: 'ask-1', signal: controller.signal }
      )
      const approval = await vi.waitFor(() => {
        const req = events.find((event) => event.type === 'tool-approval-request')
        expect(req).toBeDefined()
        return req!
      })
      if (approval.type !== 'tool-approval-request') throw new Error('Missing approval')
      expect(approval.request.toolName).toBe('AskUserQuestion')
      toolApprovalRegistry.dispatch(approval.request.approvalId, {
        approved: true,
        updatedInput: { answers: { q1: 'yes' } }
      })
      await expect(questionPromise).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { answers: { q1: 'yes' } }
      })
      release()
      await sending
    } finally {
      release()
      await connection.close()
      await drained
    }
  })

  it('persists session-scoped Claude tool approvals from allow_session, rewrites suggestion destinations to session, and avoids leaking localPermissionOption', async () => {
    sdk.messages = [result()]
    let release!: () => void
    sdk.returnGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const connection = new ClaudeConnection('session', 'agent', {
      protocol: 'claude',
      enabled: true,
      args: [],
      env: {}
    })
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    try {
      await connection.start('/tmp')
      const sending = connection.send(input)
      await vi.waitFor(() => expect(sdk.returning).toBe(true))

      const canUseTool = sdk.queryOptions.at(-1)?.canUseTool as (
        name: string,
        toolInput: Record<string, unknown>,
        opts: { toolUseID: string; signal: AbortSignal; suggestions?: Array<Record<string, unknown>> }
      ) => Promise<Record<string, unknown>>
      const controller = new AbortController()

      const bashPromise = canUseTool(
        'Bash',
        { command: 'echo 1' },
        {
          toolUseID: 'bash-1',
          signal: controller.signal,
          suggestions: [
            { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'userSettings' }
          ]
        }
      )
      const bashApproval = await vi.waitFor(() => {
        const req = events.find((event) => event.type === 'tool-approval-request')
        expect(req).toBeDefined()
        return req!
      })
      if (bashApproval.type !== 'tool-approval-request') throw new Error('Missing approval')
      expect(bashApproval.request.input.localPermissionOptions).toContainEqual(
        expect.objectContaining({ optionId: 'allow_session', label: 'allow_session', kind: 'allow_always' })
      )
      toolApprovalRegistry.dispatch(bashApproval.request.approvalId, {
        approved: true,
        updatedInput: { command: 'echo 1', localPermissionOption: 'allow_session' }
      })
      await expect(bashPromise).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { command: 'echo 1' },
        updatedPermissions: [
          { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }
        ]
      })

      // Subsequent calls to Bash auto-approve with zero extra prompts.
      await expect(
        canUseTool('Bash', { command: 'echo 2' }, { toolUseID: 'bash-2', signal: controller.signal })
      ).resolves.toEqual({ behavior: 'allow', updatedInput: { command: 'echo 2' } })
      expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(1)

      // Different tools still prompt and preserve denial.
      const writePromise = canUseTool(
        'Write',
        { file_path: '/tmp/out.txt', content: 'hi' },
        { toolUseID: 'write-1', signal: controller.signal }
      )
      await vi.waitFor(() => expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(2))
      const writeApproval = events.filter((event) => event.type === 'tool-approval-request')[1]
      if (writeApproval.type !== 'tool-approval-request') throw new Error('Missing write approval')
      toolApprovalRegistry.dispatch(writeApproval.request.approvalId, {
        approved: false,
        reason: 'User declined'
      })
      await expect(writePromise).resolves.toEqual({ behavior: 'deny', message: 'User declined' })

      release()
      await sending
    } finally {
      release()
      await connection.close()
      await drained
    }
  })

  it('stamps localAgentProtocol: claude on tool chunks while preserving claude-code parent metadata', async () => {
    sdk.messages = [
      {
        type: 'assistant',
        parent_tool_use_id: 'parent-tool',
        message: {
          model: 'native-model',
          content: [
            {
              type: 'tool_use',
              id: 'write-1',
              name: 'Write',
              input: { file_path: '/tmp/a.html', content: '<h1>hi</h1>' }
            }
          ]
        }
      } as SDKMessage,
      {
        type: 'user',
        parent_tool_use_id: 'parent-tool',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'write-1', content: 'Wrote file' }]
        }
      },
      result()
    ]

    const { chunks } = await run()
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'dynamic-tool',
        state: 'input-available',
        toolCallId: 'write-1',
        toolName: 'Write',
        callProviderMetadata: expect.objectContaining({
          'claude-code': expect.objectContaining({ parentToolCallId: 'parent-tool' }),
          cherry: expect.objectContaining({ localAgentProtocol: 'claude' })
        })
      })
    )
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 'write-1',
        resultProviderMetadata: expect.objectContaining({
          'claude-code': expect.objectContaining({ parentToolCallId: 'parent-tool' }),
          cherry: expect.objectContaining({ localAgentProtocol: 'claude' })
        })
      })
    )
  })

  it('injects session-scoped browser MCP into query(), honors browser toggle, maps plan mode to read-only, and disposes on close', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    let issuedInput: { isReadOnly?: () => boolean } | undefined
    const issueBrowserLease = vi.fn(async (inputArg: { isReadOnly?: () => boolean }) => {
      issuedInput = inputArg
      return {
        url: 'http://127.0.0.1:43123/mcp/lease-1',
        token: 'tok-claude',
        headers: { Authorization: 'Bearer tok-claude' },
        dispose
      }
    })
    vi.spyOn(application, 'getExisting').mockImplementation(((name: string) => {
      if (name === 'LocalAgentMcpBridgeService') return { issueBrowserLease }
      if (name === 'PreferenceService') {
        return {
          get: (key: Parameters<typeof MockMainPreferenceServiceUtils.getPreferenceValue>[0]) =>
            MockMainPreferenceServiceUtils.getPreferenceValue(key)
        }
      }
      return undefined
    }) as typeof application.getExisting)

    sdk.messages = [result()]
    const connection = new ClaudeConnection('session-c', 'agent-c', {
      protocol: 'claude',
      presetId: 'claude',
      enabled: true,
      args: [],
      env: {}
    })
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()

    try {
      await connection.start('/tmp')
      expect(issueBrowserLease).toHaveBeenCalledTimes(1)
      expect(issuedInput?.isReadOnly?.()).toBe(false)
      await connection.setMode('claude-mode', 'plan')
      expect(issuedInput?.isReadOnly?.()).toBe(true)

      await connection.send(input)
      const options = sdk.queryOptions.at(-1) as {
        mcpServers?: Record<string, unknown>
        canUseTool?: (
          name: string,
          args: Record<string, unknown>,
          opts: { toolUseID: string; signal: AbortSignal }
        ) => Promise<unknown>
      }
      expect(options.mcpServers).toEqual({
        automation: {
          type: 'http',
          url: 'http://127.0.0.1:43123/mcp/lease-1',
          headers: { Authorization: 'Bearer tok-claude' }
        }
      })

      MockMainPreferenceServiceUtils.setPreferenceValue('app.browser.agent_control.enabled', true)
      await expect(
        options.canUseTool?.(
          'mcp__automation__js',
          { code: '1' },
          { toolUseID: 'call-1', signal: new AbortController().signal }
        )
      ).resolves.toEqual({ behavior: 'allow', updatedInput: { code: '1' } })

      MockMainPreferenceServiceUtils.setPreferenceValue('app.browser.agent_control.enabled', false)
      await expect(
        options.canUseTool?.(
          'mcp__automation__reset',
          {},
          { toolUseID: 'call-2', signal: new AbortController().signal }
        )
      ).resolves.toEqual({ behavior: 'deny', message: 'Built-in browser control is disabled' })
    } finally {
      await connection.close()
      await drained
    }
    expect(dispose).toHaveBeenCalledTimes(1)

    issueBrowserLease.mockClear()
    const headlessConn = new ClaudeConnection(
      'session-h',
      'agent-c',
      { protocol: 'claude', presetId: 'claude', enabled: true, args: [], env: {} },
      true
    )
    const disabledConn = new ClaudeConnection('session-d', 'agent-c', {
      protocol: 'claude',
      presetId: 'claude',
      enabled: true,
      browserControl: 'disabled',
      args: [],
      env: {}
    })
    await headlessConn.start('/tmp')
    await disabledConn.start('/tmp')
    expect(issueBrowserLease).not.toHaveBeenCalled()
    await headlessConn.close()
    await disabledConn.close()
  })
})
