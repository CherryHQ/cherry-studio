import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { AssistantMessage } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { obj } from '@earendil-works/pi-schema'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { runtimeId, type InputState } from '@cherrystudio/agent-runtime'
import type { PiThreadHandle } from '@cherrystudio/agent-runtime-pi'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { savedChildView } from '@main/ai/agentSession/ChildThreadProjection'
import { prepareNativeSubmission } from '@main/ai/agentSession/nativeSubmission'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { ToolGuardInteractionState } from '@main/ai/toolApproval/toolGuards'
import type { AgentChildUpdate } from '@shared/ai/agentChildProjection'
import { ModelSchema } from '@shared/data/types/model'
import { ProviderSchema } from '@shared/data/types/provider'

import {
  assistantReply,
  createTestBinding,
  MODEL,
  scriptedModel,
  respondingModel,
  tempDir
} from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { gate, subagentCall, toolCallPart } from '../../../../../packages/agent-runtime-pi/tests/subagentSupport'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import * as piBehaviorHost from './piBehaviorHost'
import type { PiConnectionSnapshot } from './piConnectionSignature'
import type * as PiMcpExtension from './piMcpExtension'
import { buildPiMcpToolName } from './piMcpExtension'
import { PiRuntimeConnection } from './PiRuntimeConnection'
import { buildPiLoginPathPrefix } from './piShell'

const modelId = 'test::test-model'
/** An approval crosses the runtime boundary and starts a native tool, so the one-second default is a race on CI. */
const APPROVAL_WAIT = { timeout: 10_000 } as const

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  binding: vi.fn(),
  prompt: vi.fn(),
  interaction: vi.fn<() => ToolGuardInteractionState>(),
  delegated: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    DbService: defaultServiceInstances.DbService,
    ApiGatewayService: {
      captureAgentSessionUsage: () => ({ headers: {}, release: () => {} }),
      ensureInternalGateway: async () => ({ baseUrl: 'http://gateway.invalid', apiKey: 'fixture' }),
      getAgentSessionUsageHeaders: () => ({})
    },
    McpCatalogService: { listTools: () => [] },
    AgentSessionRuntimeService: { getInteractionState: mocks.interaction }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('./piConnectionSignature', () => ({
  capturePiConnectionSnapshot: mocks.capture,
  PiInvalidConnectionSnapshotError: class extends Error {}
}))
vi.mock('./gatewayModelBinding', () => ({ createPiGatewayModelBinding: mocks.binding }))
vi.mock('@main/ai/runtime/agentPrompt', () => ({ buildAgentRuntimePrompt: mocks.prompt }))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({
  warmAgentMcpToolCatalogs: async () => {},
  buildAgentMcpServers: () => ({})
}))
vi.mock('./piMcpExtension', async (original) => ({
  ...(await original<typeof PiMcpExtension>()),
  createPiMcpExtension: () => (pi: { registerTool: (tool: unknown) => void }) => {
    for (const name of ['session_create', 'session_send'])
      pi.registerTool({
        name: buildPiMcpToolName('cherry-tools', name),
        label: name,
        description: name,
        parameters: obj({}),
        execute: async () => {
          mocks.delegated()
          return { content: [{ type: 'text', text: 'delegated' }] }
        }
      })
  }
}))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({}), getPathFromEnvironment: () => undefined }))

// Real Runtime, native Pi and SQLite; only provider/environment configuration is substituted.
describe('desktop Pi root connection', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let input: AgentRuntimeConnectInput
  let snapshot: PiConnectionSnapshot
  let script: ReturnType<typeof scriptedModel>
  const connections: PiRuntimeConnection[] = []

  beforeEach(() => {
    mocks.interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    mocks.delegated.mockClear()
    directory = tempDir('desktop-pi')
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const dir = join(directory, key)
      if (key !== 'external.pi.settings_file' && key !== 'feature.agents.pi.sessions')
        mkdirSync(dir, { recursive: true })
      return file ? join(dir, file) : dir
    })
    const agentId = uuid()
    const workspaceId = uuid()
    input = { sessionId: uuid(), agentId, modelId: modelId }
    dbh.db
      .insert(agentTable)
      .values({
        id: agentId,
        name: 'Pi',
        type: 'pi',
        instructions: '',
        configuration: { permission_mode: 'bypassPermissions' },
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Work', path: directory, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: input.sessionId, agentId, workspaceId, name: 'Chat', orderKey: 'a0' })
      .run()
    snapshot = {
      agent: { ...agentService.getAgent(agentId)!, model: modelId },
      session: agentSessionService.getById(input.sessionId),
      model: ModelSchema.parse({
        id: modelId,
        providerId: 'test',
        name: 'Model',
        capabilities: ['function-call'],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }),
      provider: ProviderSchema.parse({
        id: 'test',
        name: 'Provider',
        settings: {},
        reportsActualCost: false,
        apiKeys: [],
        authType: 'api-key',
        isEnabled: true
      }),
      additionalSkillPaths: [],
      mcpServerSnapshots: new Map(),
      linkedChannel: null,
      effectiveLanguage: null,
      signature: 'frozen'
    }
    mocks.capture.mockImplementation(async () => snapshot)
    mocks.prompt.mockResolvedValue({ base: { kind: 'custom', content: 'You are Cherry.' } })
    setScript([assistantReply('Hello world')])
    mocks.binding.mockImplementation(async () => createTestBinding({ model: MODEL, stream: script.model }))
  })
  afterEach(async () => {
    for (const connection of connections.splice(0)) await connection.close()
    vi.restoreAllMocks()
  })
  function setScript(parts: AssistantMessage[], delay?: number) {
    script = scriptedModel(parts, delay)
  }
  function holdResponse(text: string) {
    const fallback = script.model
    let finish!: () => void
    let started = false
    script.model = (model, context, options) => {
      if (started) return fallback(model, context, options)
      started = true
      const stream = createAssistantMessageEventStream()
      const message = { ...assistantReply(text), model: model.id, api: model.api, provider: model.provider }
      stream.push({ type: 'start', partial: message })
      stream.push({ type: 'text_start', contentIndex: 0, partial: message })
      stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message })
      const abort = () => {
        message.stopReason = 'aborted'
        stream.push({ type: 'error', reason: 'aborted', error: message })
        stream.end(message)
      }
      options?.signal?.addEventListener('abort', abort, { once: true })
      finish = () => {
        options?.signal?.removeEventListener('abort', abort)
        stream.push({ type: 'done', reason: 'stop', message })
        stream.end(message)
      }
      return stream
    }
    return () => finish()
  }
  function message(text: string) {
    return messages.saveMessage({
      sessionId: input.sessionId,
      message: { id: uuid(), role: 'user', data: { parts: [{ type: 'text', text }] } }
    })
  }
  async function connect() {
    const connection = await new PiRuntimeConnection(input).start()
    connections.push(connection)
    const nativeInputs: InputState[] = []
    const handle = (connection as unknown as { handle: PiThreadHandle }).handle
    await handle.observe((event) => {
      if (event.type === 'snapshot') nativeInputs.push(...event.inputs)
      if (event.type === 'input.changed') nativeInputs.push(event.input)
    })
    const events: AgentRuntimeEvent[] = []
    const consuming = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    return { connection, events, consuming, nativeInputs }
  }
  async function done(events: AgentRuntimeEvent[], timeout?: number) {
    await expect
      .poll(() => events.some((event) => event.type === 'turn-complete' || event.type === 'error'), { timeout })
      .toBe(true)
  }
  function projected(events: AgentRuntimeEvent[]) {
    const messages = new Map<
      string,
      Extract<AgentRuntimeEvent, { type: 'message-projection' }>['projection']['messages'][number]
    >()
    for (const event of events) {
      if (event.type !== 'message-projection') continue
      for (const old of [...Object.keys(event.projection.replaces), ...event.projection.removed]) messages.delete(old)
      for (const message of event.projection.messages)
        if (event.projection.live.includes(message.id)) messages.set(message.id, message)
    }
    return [...messages.values()]
  }
  const text = (events: AgentRuntimeEvent[]) =>
    projected(events)
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
      .join('')
  function nativeFiles() {
    const directory = application.getPath('feature.agents.pi.sessions')
    return existsSync(directory) ? readdirSync(directory) : []
  }

  it.each([false, true])('limits PowerShell exposure to Windows and honors disabledTools (%s)', async (disabled) => {
    snapshot.agent.disabledTools = disabled ? ['PowerShell'] : []
    const { connection, events } = await connect()
    await connection.send({ message: message('List available tools') })
    await done(events)
    const names = script.calls[0].tools.map((tool) => tool.name)
    if (process.platform === 'win32' && !disabled) expect(names).toContain('powershell')
    else expect(names).not.toContain('powershell')
  })

  it.runIf(process.platform === 'win32')(
    'runs PowerShell file commands with Unicode and space-containing paths',
    async () => {
      setScript([
        assistantReply(
          [
            {
              type: 'toolCall',
              id: 'powershell-file',
              name: 'powershell',
              arguments: {
                command:
                  "Set-Content -LiteralPath './报告 with spaces.txt' -Value 'PowerShell 正常' -Encoding utf8; Get-Content -LiteralPath './报告 with spaces.txt'"
              }
            }
          ],
          'toolUse'
        ),
        assistantReply('PowerShell finished')
      ])
      const { connection, events } = await connect()
      await connection.send({ message: message('Write and read the PowerShell fixture') })
      await done(events, 10_000)
      expect(
        readFileSync(join(directory, '报告 with spaces.txt'), 'utf8')
          .replace(/^\uFEFF/, '')
          .trim()
      ).toBe('PowerShell 正常')
      const output = projected(events)
        .flatMap((entry) => entry.parts)
        .find((part) => part.type === 'dynamic-tool' && part.toolCallId === 'powershell-file')
      expect(output).toMatchObject({ state: 'output-available' })
      expect(JSON.stringify(output)).toContain('PowerShell 正常')
    }
  )

  // Catches a child's incidental bypass mode overriding the root's installation policy.
  it.each([
    { mode: 'default', approved: true },
    { mode: 'default', approved: false },
    { mode: 'auto', approved: true },
    { mode: 'auto', approved: false },
    { mode: 'plan', approved: false },
    { mode: 'bypassPermissions', approved: true }
  ] as const)('uses root $mode for child installs (approved=$approved)', async ({ mode, approved }) => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: mode }
    const marker = join(directory, 'child-install.txt')
    const prefixMarker = join(directory, 'before-install.txt')
    // A shell function records execution without installing a real package.
    const command = `echo started > "${prefixMarker}"\nnpm() { echo installed > "${marker}"; }\nnpm install -g left-pad`
    let root = ''
    let childResult = ''
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) {
        const result = call.messages.find(
          (entry) => entry.role === 'toolResult' && entry.toolCallId === 'child-install'
        )
        if (!result) return assistantReply([toolCallPart('child-install', 'bash', { command })], 'toolUse')
        childResult = JSON.stringify(result)
        return assistantReply('child done')
      }
      if (!call.messages.some((entry) => entry.role === 'toolResult'))
        return assistantReply(
          [toolCallPart('spawn', 'subagent', { description: 'install', prompt: 'install tool', fork: false })],
          'toolUse'
        )
      return assistantReply('parent done')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('delegate') })
    if (mode === 'default' || mode === 'auto') {
      await expect
        .poll(() => events.filter((event) => event.type === 'tool-approval-request').length, { timeout: 15_000 })
        .toBe(1)
      expect(existsSync(marker)).toBe(false)
      expect(existsSync(prefixMarker)).toBe(false)
      const event = events.find((event) => event.type === 'tool-approval-request')!
      if (event.type !== 'tool-approval-request') throw new Error('Missing installation approval')
      expect(event.request.input).toEqual({ command })
      toolApprovalRegistry.dispatch(event.request.approvalId, { approved })
    }
    await done(events, 15_000)
    expect(existsSync(marker)).toBe(approved)
    expect(existsSync(prefixMarker)).toBe(approved)
    if (mode === 'plan') expect(childResult).toContain('Plan mode is read-only')
    else if (!approved) expect(childResult).toContain('rejected')
    if (mode === 'plan' || mode === 'bypassPermissions')
      expect(events.filter((event) => event.type === 'tool-approval-request')).toEqual([])
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  it('requires approval for subagent writes when the root uses default permissions', async () => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'default' }
    let root = ''
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) {
        if (!call.messages.some((entry) => entry.role === 'toolResult' && entry.toolCallId === 'child-write'))
          return assistantReply(
            [toolCallPart('child-write', 'write', { path: 'child-result.txt', content: 'child completed' })],
            'toolUse'
          )
        return assistantReply('child done')
      }
      if (!call.messages.some((entry) => entry.role === 'toolResult'))
        return assistantReply(
          [toolCallPart('spawn', 'subagent', { description: 'write', prompt: 'write result', fork: false })],
          'toolUse'
        )
      return assistantReply('parent done')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('delegate') })
    const approvals = () => events.filter((event) => event.type === 'tool-approval-request')
    await expect.poll(() => approvals().length, APPROVAL_WAIT).toBe(1)
    expect(approvals()[0].request).toMatchObject({ toolCallId: 'child-write', toolName: 'write' })
    expect(existsSync(join(directory, 'child-result.txt'))).toBe(false)
    toolApprovalRegistry.dispatch(approvals()[0].request.approvalId, { approved: true })
    await done(events)
    expect(readFileSync(join(directory, 'child-result.txt'), 'utf8')).toBe('child completed')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  it.each(['auto', 'bypassPermissions'] as const)(
    'preserves live delegation approval in %s mode after connecting through the Runtime',
    async (permission_mode) => {
      snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode }
      const tool = buildPiMcpToolName('cherry-tools', 'session_send')
      setScript([
        assistantReply([{ type: 'toolCall', id: 'interactive', name: tool, arguments: {} }], 'toolUse'),
        assistantReply('first done'),
        assistantReply([{ type: 'toolCall', id: 'headless', name: tool, arguments: {} }], 'toolUse'),
        assistantReply('second done'),
        assistantReply([{ type: 'toolCall', id: 'ask', name: tool, arguments: {} }], 'toolUse'),
        assistantReply('third done')
      ])
      const { connection, events } = await connect()
      await connection.send({ message: message('interactive') })
      await done(events)
      expect(mocks.delegated.mock.calls.length).toBe(1)
      events.length = 0
      mocks.interaction.mockReturnValue({ currentTurn: 'headless', userResponse: 'unavailable' })
      await connection.send({ message: message('headless') })
      await done(events)
      const refused = script.calls.at(-1)!.messages.findLast((entry) => entry.role === 'toolResult')
      expect(JSON.stringify(refused)).toContain('Cross-Session delegation requires an interactive user turn')
      expect(mocks.delegated.mock.calls.length).toBe(1)
      expect(toolApprovalRegistry.size()).toBe(0)
      events.length = 0
      mocks.interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
      snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'default' }
      expect(await connection.reconcile({ modelId: input.modelId })).toBe('patched')
      await connection.send({ message: message('ask') })
      await expect
        .poll(() => events.find((event) => event.type === 'tool-approval-request'), APPROVAL_WAIT)
        .toBeDefined()
      const request = events.find((event) => event.type === 'tool-approval-request')!
      if (request.type !== 'tool-approval-request') throw new Error('No approval')
      expect(request.request.toolCallId).toBe('ask')
      toolApprovalRegistry.dispatch(request.request.approvalId, {
        approved: false,
        reasonSource: 'user',
        reason: 'declined'
      })
      await done(events)
      expect(mocks.delegated.mock.calls.length).toBe(1)
      expect(script.calls.at(-1)!.messages.findLast((entry) => entry.role === 'toolResult')).toMatchObject({
        content: [expect.objectContaining({ text: expect.stringContaining('the user said:\ndeclined') })]
      })
    }
  )

  // Catches approval edits being shown in the UI but the original write still executing.
  it('executes only approved arguments and returns a question answer to the native loop', async () => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'default' }
    setScript([
      assistantReply([toolCallPart('write', 'write', { path: 'original.txt', content: 'original' })], 'toolUse'),
      assistantReply(
        [
          toolCallPart('ask', 'AskUserQuestion', {
            questions: [
              {
                question: 'Which database?',
                header: 'Database',
                options: [
                  { label: 'Postgres', description: 'Relational' },
                  { label: 'Redis', description: 'In memory' }
                ]
              }
            ]
          })
        ],
        'toolUse'
      ),
      assistantReply('Use Redis')
    ])
    const { connection, events } = await connect()
    await connection.send({ message: message('write and ask') })
    const approvals = () => events.filter((event) => event.type === 'tool-approval-request')
    await expect.poll(() => approvals().length, APPROVAL_WAIT).toBe(1)
    expect(existsSync(join(directory, 'original.txt'))).toBe(false)
    expect(approvals()[0].request.toolCallId).toBe('write')
    toolApprovalRegistry.dispatch(approvals()[0].request.approvalId, {
      approved: true,
      updatedInput: { path: 'approved.txt', content: 'approved' }
    })
    await expect.poll(() => approvals().length, APPROVAL_WAIT).toBe(2)
    expect(approvals()[1].request).toMatchObject({ toolCallId: 'ask', toolName: 'AskUserQuestion' })
    toolApprovalRegistry.dispatch(approvals()[1].request.approvalId, {
      approved: true,
      updatedInput: { answers: { 'Which database?': 'Redis' } }
    })
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(readFileSync(join(directory, 'approved.txt'), 'utf8')).toBe('approved')
    expect(existsSync(join(directory, 'original.txt'))).toBe(false)
    expect(JSON.stringify(script.calls.at(-1)!.messages)).toContain('Redis')
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  // Catches the reported endpoint path at the root: `auto` running a shell command from the model
  // response with no approval surface. The grant then covers routine shell, but never a shape whose
  // blast radius is unbounded, so `bash -c` asks again.
  it('asks a person before the root runs an ungranted or unbounded shell command in auto mode', async () => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'auto' }
    const first = join(directory, 'root-proof-1.txt')
    const second = join(directory, 'root-proof-2.txt')
    const third = join(directory, 'root-proof-3.txt')
    setScript([
      assistantReply([toolCallPart('root-1', 'bash', { command: 'printf first > root-proof-1.txt' })], 'toolUse'),
      assistantReply([toolCallPart('root-2', 'bash', { command: 'printf second > root-proof-2.txt' })], 'toolUse'),
      assistantReply(
        [toolCallPart('root-3', 'bash', { command: "bash -c 'printf third > root-proof-3.txt'" })],
        'toolUse'
      ),
      assistantReply('finished')
    ])
    const { connection, events } = await connect()
    await connection.send({ message: message('hi') })
    const approvals = () => events.filter((event) => event.type === 'tool-approval-request')

    await expect.poll(() => approvals().length, APPROVAL_WAIT).toBe(1)
    expect(approvals()[0].request).toMatchObject({
      toolCallId: 'root-1',
      toolName: 'bash',
      input: { command: 'printf first > root-proof-1.txt' }
    })
    expect(existsSync(first)).toBe(false)
    toolApprovalRegistry.dispatch(approvals()[0].request.approvalId, { approved: true })

    // The grant is the point of `auto`: the next ordinary command runs with no second prompt. Inline
    // source is unbounded, so the grant never covers it and only the third call asks again.
    await expect.poll(() => existsSync(second), APPROVAL_WAIT).toBe(true)
    await expect.poll(() => approvals().length, APPROVAL_WAIT).toBe(2)
    expect(approvals().map((event) => event.request.toolCallId)).toEqual(['root-1', 'root-3'])
    expect(existsSync(third)).toBe(false)
    toolApprovalRegistry.dispatch(approvals()[1].request.approvalId, { approved: true })

    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(readFileSync(first, 'utf8')).toBe('first')
    expect(readFileSync(second, 'utf8')).toBe('second')
    expect(readFileSync(third, 'utf8')).toBe('third')
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  // Catches a mid-turn mode switch that only reaches the next turn: the running turn's next tool call
  // would still be approved (or skipped) under the mode the user just left.
  it.each([
    { from: 'bypassPermissions', to: 'default', asksForWrite: true },
    { from: 'default', to: 'bypassPermissions', asksForWrite: false }
  ] as const)('applies a $from → $to switch to the running turn', async ({ from, to, asksForWrite }) => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: from }
    setScript([
      assistantReply(
        [
          toolCallPart('ask', 'AskUserQuestion', {
            questions: [
              {
                question: 'Continue?',
                header: 'Continue',
                options: [
                  { label: 'Yes', description: 'Go on' },
                  { label: 'No', description: 'Stop' }
                ]
              }
            ]
          })
        ],
        'toolUse'
      ),
      assistantReply([toolCallPart('write', 'write', { path: 'after-switch.txt', content: 'written' })], 'toolUse'),
      assistantReply('finished')
    ])
    const { connection, events } = await connect()
    await connection.send({ message: message('ask then write') })
    const approvals = () => events.filter((event) => event.type === 'tool-approval-request')
    await expect.poll(() => approvals().length, APPROVAL_WAIT).toBe(1)

    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: to }
    expect(await connection.reconcile({ modelId: input.modelId })).toBe('patched')
    toolApprovalRegistry.dispatch(approvals()[0].request.approvalId, {
      approved: true,
      updatedInput: { answers: { 'Continue?': 'Yes' } }
    })

    if (asksForWrite) {
      await expect.poll(() => approvals().length, APPROVAL_WAIT).toBe(2)
      expect(approvals()[1].request).toMatchObject({ toolCallId: 'write' })
      expect(existsSync(join(directory, 'after-switch.txt'))).toBe(false)
      toolApprovalRegistry.dispatch(approvals()[1].request.approvalId, { approved: true })
    }
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(approvals()).toHaveLength(asksForWrite ? 2 : 1)
    expect(readFileSync(join(directory, 'after-switch.txt'), 'utf8')).toBe('written')
  })

  // Catches shutdown waiting indefinitely for an unanswered desktop question.
  it('withdraws a pending question on close without another model request', async () => {
    setScript([
      assistantReply(
        [
          toolCallPart('ask', 'AskUserQuestion', {
            questions: [
              {
                question: 'Continue?',
                header: 'Next',
                options: [
                  { label: 'Yes', description: 'Continue' },
                  { label: 'No', description: 'Stop' }
                ]
              }
            ]
          })
        ],
        'toolUse'
      )
    ])
    const { connection, events, consuming } = await connect()
    await connection.send({ message: message('ask') })
    await expect.poll(() => events.some((event) => event.type === 'tool-approval-request'), APPROVAL_WAIT).toBe(true)
    await connection.close()
    await consuming
    expect(toolApprovalRegistry.size()).toBe(0)
    expect(script.calls).toHaveLength(1)
  })

  // Catches a model endpoint escaping root approval by delegating code execution to a child.
  it.each(
    ['bash', 'codemode'].flatMap((tool) =>
      [false, true].flatMap((background) =>
        ['approved', 'denied', 'unavailable'].map((answer) => ({ tool, background, answer }))
      )
    )
  )('gates child $tool with background=$background and answer=$answer', async ({ tool, background, answer }) => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'auto' }
    if (tool === 'codemode') {
      const createHost = piBehaviorHost.createPiBehaviorHost
      vi.spyOn(piBehaviorHost, 'createPiBehaviorHost').mockImplementation(async (options) => {
        const host = await createHost(options)
        return {
          ...host,
          configureChild: async (child) => ({
            ...(await host.configureChild(child)),
            // Pi registers codemode inactive; exercise its gate with the native tool enabled.
            builtinTools: ['bash', 'read', 'write', 'edit', 'codemode']
          })
        }
      })
    }
    if (answer === 'unavailable')
      mocks.interaction.mockReturnValue({ currentTurn: 'headless', userResponse: 'unavailable' })
    let root = ''
    let childCalled = false
    const proof = join(directory, 'child-proof.txt')
    const args: Record<string, string> =
      tool === 'bash'
        ? { command: 'printf executed > child-proof.txt' }
        : { code: 'await tools.write({ path: "child-proof.txt", content: "executed" })' }
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) {
        if (call.messages.at(-1)?.role === 'user') {
          childCalled = true
          return assistantReply([toolCallPart('child-exec', tool, args)], 'toolUse')
        }
        return assistantReply('child finished')
      }
      if (call.messages.at(-1)?.role === 'user')
        return assistantReply(
          [subagentCall('spawn', { description: 'run command', prompt: 'execute the task', background })],
          'toolUse'
        )
      return assistantReply('parent finished')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('delegate code execution') })
    if (answer !== 'unavailable') {
      const approvals = () => events.filter((event) => event.type === 'tool-approval-request')
      await expect.poll(() => approvals().length, APPROVAL_WAIT).toBe(1)
      expect(approvals()[0].request).toMatchObject({ toolName: tool, toolCallId: 'child-exec', input: args })
      expect(existsSync(proof)).toBe(false)
      toolApprovalRegistry.dispatch(approvals()[0].request.approvalId, { approved: answer === 'approved' })
    }
    await done(events)
    await connection.drainChildWrites()
    expect(childCalled).toBe(true)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    if (answer === 'approved') expect(readFileSync(proof, 'utf8')).toBe('executed')
    else {
      expect(existsSync(proof)).toBe(false)
      const results = script.calls.flatMap((call) => call.messages.filter((message) => message.role === 'toolResult'))
      expect(JSON.stringify(results)).toContain(answer === 'denied' ? 'tool use was rejected' : 'unattended')
    }
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  // Catches a child stream being dropped or attributed to the root's text, and a continuation creating a new child.
  it('streams a foreground child and continues the same child in the desktop connection', async () => {
    let root = ''
    let child = ''
    let childRuns = 0
    script = respondingModel((call) => {
      if (call.sessionId !== root) {
        child = call.sessionId!
        childRuns++
        return {
          ...assistantReply(childRuns === 1 ? 'child first answer' : 'child continued answer'),
          responseId: `child-response-${childRuns}`
        }
      }
      const last = JSON.stringify(call.messages.at(-1))
      if (last.includes('delegate now'))
        return assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'scan files' })], 'toolUse')
      if (last.includes('continue child'))
        return assistantReply(
          [toolCallPart('continue', 'message_subagent', { id: child, message: 'continue work' })],
          'toolUse'
        )
      return assistantReply('parent finished')
    }, 1)
    const { connection, events } = await connect()
    await connection.send({ message: message('initialize') })
    await done(events)
    root = script.calls[0].sessionId!
    childRuns = 0
    events.length = 0
    await connection.send({ message: message('delegate now') })
    await done(events)
    const firstChild = child
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    const access = await connection.childProjection('spawn')
    expect(access).toBeDefined()
    expect(access!.snapshot().canSubmit).toBe(true)
    const childText = () =>
      access!
        .snapshot()
        .messages.flatMap((message) =>
          message.role === 'assistant' ? message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])) : []
        )
        .join('')
    await expect.poll(childText).toBe('child first answer')
    expect(text(events)).toBe('parent finished')
    const before = access!.snapshot()
    const subscriberA: unknown[] = []
    const subscriberB: unknown[] = []
    const detach = access!.subscribe((update) => subscriberA.push(update))
    access!.subscribe((update) => subscriberB.push(update))
    detach()
    events.length = 0
    await connection.send({ message: message('continue child') })
    await done(events)
    await expect.poll(() => childText()).toContain('child continued answer')
    const childMessage = access!
      .snapshot()
      .messages.find((message) =>
        message.parts.some((part) => part.type === 'text' && part.text === 'child continued answer')
      )!
    await expect
      .poll(() => events.filter((event) => event.type === 'response-start' && event.responseId === 'child-response-2'))
      .toContainEqual({
        type: 'response-start',
        responseId: 'child-response-2',
        messageId: childMessage.id
      })
    expect(child).toBe(firstChild)
    expect(nativeFiles()).toHaveLength(2)
    await expect
      .poll(() =>
        script.calls
          .filter((call) => call.sessionId === root)
          .some((call) => JSON.stringify(call.messages).includes('child continued answer'))
      )
      .toBe(true)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(subscriberA).toEqual([])
    expect(subscriberB.length).toBeGreaterThan(0)
    expect(
      access!
        .snapshot()
        .messages.slice(0, before.messages.length)
        .map((value) => value.id),
      JSON.stringify({ before: before.messages, after: access!.snapshot().messages }, null, 2)
    ).toEqual(before.messages.map((value) => value.id))
    const archived = access!.snapshot()
    await connection.close()
    const requests = script.calls.length
    const reopened = (await connect()).connection
    const recovered = await reopened.childProjection('spawn')
    expect(recovered).toBeDefined()
    await expect
      .poll(() => recovered!.snapshot().messages.map((value) => value.id))
      .toEqual(archived.messages.map((value) => value.id))
    expect(script.calls.length).toBe(requests)
    expect(contexts.findChild(input.sessionId, 'spawn')?.sessionId).toBe(archived.sessionId)
    expect(() => preparePiBranch(archived.sessionId)).toThrow('native owner')
    await expect(reopened.messageChild(archived.contextId, 'continue after restart')).rejects.toThrow(
      'turn was stopped'
    )
    await reopened.send({ message: message('new parent turn') })
    await expect.poll(() => script.calls.length).toBeGreaterThan(requests)
    await reopened.messageChild(archived.contextId, 'continue after new turn')
    await expect.poll(() => childRuns).toBe(3)
    expect(child).toBe(firstChild)
  })

  // Catches a recovered root being rebuilt forever after one historical child reports a startup error.
  it('keeps a reopened parent usable and its child archive readable when child configuration fails', async () => {
    let root = ''
    script = respondingModel((call) => {
      if (call.sessionId !== root) return assistantReply('saved child answer')
      if (JSON.stringify(call.messages.at(-1)).includes('delegate now'))
        return assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'scan files' })], 'toolUse')
      return assistantReply('parent answer')
    })
    const first = await connect()
    await first.connection.send({ message: message('initialize') })
    await done(first.events)
    root = script.calls[0].sessionId!
    first.events.length = 0
    await first.connection.send({ message: message('delegate now') })
    await done(first.events)
    const child = await first.connection.childProjection('spawn')
    expect(child).toBeDefined()
    const archive = child!.snapshot()
    await first.connection.close()
    const createHost = piBehaviorHost.createPiBehaviorHost
    vi.spyOn(piBehaviorHost, 'createPiBehaviorHost').mockImplementation(async (options) => ({
      ...(await createHost(options)),
      configureChild: async () => {
        throw new Error('Historical child model is unavailable')
      }
    }))
    const before = script.calls.length
    const reopened = await connect()
    expect(script.calls).toHaveLength(before)
    expect(await reopened.connection.reconcile(input)).toBe('current')
    expect(await reopened.connection.childProjection('spawn')).toBeUndefined()
    const saved = savedChildView(contexts.context(archive.contextId))
    expect(saved.available).toBe(false)
    expect(saved.messages).toEqual(archive.messages)
    await expect(reopened.connection.messageChild(archive.contextId, 'continue child')).rejects.toThrow('unavailable')
    await reopened.connection.send({ message: message('continue parent') })
    await done(reopened.events)
    expect(reopened.events.filter((event) => event.type === 'error')).toEqual([])
    expect(text(reopened.events)).toBe('parent answer')
  })

  // Catches a backup finishing on the input receipt while native continuation/archive writes are still pending.
  it.each(['complete', 'close'] as const)('drains an acknowledged child continuation through %s', async (outcome) => {
    const answering = gate()
    let root = ''
    let childRuns = 0
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) {
        childRuns++
        return childRuns === 1 ? assistantReply('First answer') : answering.wait(assistantReply('Final answer'))
      }
      if (JSON.stringify(call.messages.at(-1)).includes('delegate now'))
        return assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'scan files' })], 'toolUse')
      return assistantReply('Parent finished')
    })
    const { connection, events } = await connect()
    try {
      await connection.send({ message: message('delegate now') })
      await done(events)
      const access = (await connection.childProjection('spawn'))!
      await connection.messageChild(access.snapshot().contextId, 'continue')
      await answering.reached
      let drained = false
      const draining = connection.drainChildWrites().then(() => {
        drained = true
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(drained).toBe(false)
      if (outcome === 'close') await connection.close()
      else answering.open()
      await draining
      const context = contexts.context(access.snapshot().contextId)
      if (outcome === 'complete') {
        expect(savedChildView(context).messages.flatMap((message) => message.parts)).toContainEqual(
          expect.objectContaining({ text: 'Final answer' })
        )
      }
      const changes = dbh.sqlite.prepare('SELECT total_changes() AS count').get()
      await new Promise((resolve) => setTimeout(resolve, 160))
      expect(dbh.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(changes)
    } finally {
      answering.open()
    }
  })

  // Catches a panel opened during child configuration missing its only chance to subscribe.
  it('waits for child configuration and streams updates through the original attachment', async () => {
    const configuring = gate()
    const answering = gate()
    const createHost = piBehaviorHost.createPiBehaviorHost
    vi.spyOn(piBehaviorHost, 'createPiBehaviorHost').mockImplementation(async (options) => {
      const host = await createHost(options)
      return {
        ...host,
        configureChild: async (child) => {
          await configuring.wait(undefined)
          return host.configureChild(child)
        }
      }
    })
    let root = ''
    const answer = 'Incremental child output. '.repeat(8)
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) return answering.wait(assistantReply(answer))
      if (JSON.stringify(call.messages.at(-1)).includes('delegate now'))
        return assistantReply([subagentCall('spawn', { description: 'stream', prompt: 'write text' })], 'toolUse')
      return assistantReply('done')
    }, 20)
    const { connection, events } = await connect()
    try {
      await connection.send({ message: message('delegate now') })
      await configuring.reached
      const attaching = connection.childProjection('spawn')
      configuring.open()
      const access = await attaching
      expect(access).toBeDefined()
      const updates: AgentChildUpdate[] = []
      access!.subscribe((update) => updates.push(update))
      answering.open()
      await expect
        .poll(() => updates.some((update) => update.active && update.patches.some((patch) => patch.type === 'append')))
        .toBe(true)
      const partial = access!.snapshot()
      const frozen = structuredClone(partial)
      await expect.poll(() => events.some((event) => event.type === 'turn-complete'), { timeout: 5000 }).toBe(true)
      await expect.poll(() => access!.snapshot().active).toBe(false)
      expect(partial).toEqual(frozen)
      expect(
        access!
          .snapshot()
          .messages.flatMap((entry) => entry.parts)
          .filter((part) => part.type === 'text')
      ).toContainEqual(expect.objectContaining({ text: answer }))
    } finally {
      configuring.open()
      answering.open()
    }
  })

  // Catches a pending panel request hanging after child creation fails or its owner closes.
  it.each(['failed', 'closed'] as const)('releases child attachment when initialization is %s', async (outcome) => {
    const configuring = gate()
    const createHost = piBehaviorHost.createPiBehaviorHost
    vi.spyOn(piBehaviorHost, 'createPiBehaviorHost').mockImplementation(async (options) => {
      const host = await createHost(options)
      return {
        ...host,
        configureChild: async (child) => {
          await configuring.wait(undefined)
          if (outcome === 'failed') throw new Error('Child model is unavailable')
          return host.configureChild(child)
        }
      }
    })
    let root = ''
    script = respondingModel((call) => {
      root ||= call.sessionId!
      return JSON.stringify(call.messages.at(-1)).includes('delegate now')
        ? assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'scan files' })], 'toolUse')
        : assistantReply('done')
    })
    const { connection, events } = await connect()
    let closing: Promise<void> | undefined
    try {
      await connection.send({ message: message('delegate now') })
      await configuring.reached
      const attaching = connection.childProjection('spawn')
      if (outcome === 'closed') closing = connection.close()
      else configuring.open()
      await expect(attaching).resolves.toBeUndefined()
      if (!closing) await done(events)
      expect(contexts.findChild(input.sessionId, 'spawn')).toBeUndefined()
      expect(script.calls.every((call) => call.sessionId === root)).toBe(true)
    } finally {
      configuring.open()
      await closing
    }
  })

  // Catches a background stop missing the child and a late stop cancelling its parent's later turn.
  it('stops a running background child without cancelling a later parent turn', async () => {
    const held = gate()
    let root = ''
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) return held.wait(assistantReply('must not finish'))
      return JSON.stringify(call.messages.at(-1)).includes('delegate now')
        ? assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'scan', background: true })], 'toolUse')
        : assistantReply('parent finished')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('delegate now') })
    await held.reached
    await done(events)
    expect(events.filter((event) => event.type === 'background-work-state').at(-1)).toMatchObject({
      active: true
    })
    const tasks = events.find((event) => event.type === 'background-tasks' && event.tasks.length > 0)
    if (tasks?.type !== 'background-tasks') throw new Error('No child task')
    expect(events.filter((event) => event.type === 'background-task-event').at(-1)).toMatchObject({
      data: { taskId: tasks.tasks[0].id, toolUseId: 'spawn', status: 'in_progress', isBackgrounded: true }
    })
    expect(await connection.stopTask(tasks.tasks[0].id)).toBe(true)
    held.open()
    await expect
      .poll(() => events.filter((event) => event.type === 'background-work-state').at(-1))
      .toMatchObject({ active: false })
    expect(events.filter((event) => event.type === 'background-task-event').at(-1)).toMatchObject({
      data: { taskId: tasks.tasks[0].id, toolUseId: 'spawn', status: 'stopped', isBackgrounded: true }
    })
    events.length = 0
    await connection.send({ message: message('later parent turn') })
    await done(events)
    expect(text(events)).toBe('parent finished')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  // Catches the desktop never opening a receive-only stream when a paused goal resumes.
  it('starts and finishes an autonomous goal turn when plan permission is lifted', async () => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'plan' }
    script = respondingModel((call) => {
      if (call.systemPrompt?.includes('Evaluate whether the objective'))
        return assistantReply('{"verdict":"met","reason":"checked"}')
      const last = call.messages.at(-1)
      if (last?.role === 'toolResult' && last.toolName === 'get_goal') {
        const content = last.content.find((part) => part.type === 'text')
        if (content?.type !== 'text') throw new Error('No goal view')
        const { goal } = JSON.parse(content.text)
        return assistantReply(
          [
            toolCallPart('complete', 'update_goal', {
              goal_id: goal.id,
              revision: goal.revision,
              action: 'complete',
              evidence: 'checked files'
            })
          ],
          'toolUse'
        )
      }
      if (last?.role === 'toolResult') return assistantReply('completed')
      return assistantReply([toolCallPart('get', 'get_goal')], 'toolUse')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('/goal check the files') })
    await done(events)
    expect(text(events)).toBe('Goal created.')
    expect(script.calls).toHaveLength(0)
    events.length = 0
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'auto' }
    expect(await connection.reconcile({ modelId: input.modelId })).toBe('patched')
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    const started = events.findIndex((event) => event.type === 'autonomous-turn-state' && event.state === 'started')
    const firstChunk = events.findIndex(
      (event) => event.type === 'message-projection' && event.projection.live.length > 0
    )
    expect(started).toBeGreaterThanOrEqual(0)
    expect(started).toBeLessThan(firstChunk)
    expect(events.filter((event) => event.type === 'autonomous-turn-state').at(-1)).toMatchObject({ state: 'finished' })
    expect(script.calls).toHaveLength(4)
    expect(events[started]).toMatchObject({ origin: { kind: 'goal-round', round: 1 } })
  })

  // Catches a verdict rejected as unverified only because the model wrapped its JSON in prose or a code fence.
  it.each([
    ['a markdown code fence', '```json\n{"verdict":"met","reason":"checked"}\n```'],
    ['a prose preamble', 'Here is the verdict:\n{"verdict":"met","reason":"checked"}']
  ])('completes a goal when the verifier wraps its verdict in %s', async (_shape, verdict) => {
    script = respondingModel((call) => {
      if (call.systemPrompt?.includes('Evaluate whether the objective')) return assistantReply(verdict)
      const last = call.messages.at(-1)
      if (last?.role === 'toolResult' && last.toolName === 'get_goal') {
        const content = last.content.find((part) => part.type === 'text')
        if (content?.type !== 'text') throw new Error('No goal view')
        const { goal } = JSON.parse(content.text)
        return assistantReply(
          [
            toolCallPart('complete', 'update_goal', {
              goal_id: goal.id,
              revision: goal.revision,
              action: 'complete',
              evidence: 'checked files'
            })
          ],
          'toolUse'
        )
      }
      if (last?.role === 'toolResult') return assistantReply('completed')
      return assistantReply([toolCallPart('get', 'get_goal')], 'toolUse')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('/goal check the files') })
    await expect.poll(() => text(events)).toContain('completed')
    const completion = projected(events)
      .flatMap((message) => message.parts)
      .find((part) => part.type === 'dynamic-tool' && part.toolName === 'update_goal')
    expect(completion).toMatchObject({ state: 'output-available' })
  })

  it('streams through the Runtime, keeps native identity without mirroring completion, and saves a native checkpoint', async () => {
    const { connection, events } = await connect()
    expect(nativeFiles()).toEqual([])
    const user = message('question')
    await connection.send({ message: user })
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(text(events)).toBe('Hello world')
    expect(messages.inputBinding(input.sessionId, user.id)).toMatchObject({ nativeInputId: expect.any(String) })
    const completion = events.find((event) => event.type === 'turn-complete')
    expect(completion).toMatchObject({ forkAnchor: { checkpoint: { runtime: 'pi', leafId: expect.any(String) } } })
    expect(nativeFiles()).toHaveLength(1)
  })

  it.each(['rejected', 'unsupported', 'unknown'] as const)(
    'releases only explicitly refused desktop input (%s)',
    async (status) => {
      const { connection, events } = await connect()
      const user = message('refused input')
      const handle = (connection as unknown as { handle: PiThreadHandle }).handle
      vi.spyOn(handle.input, 'submit').mockResolvedValueOnce({
        status,
        inputId: runtimeId(user.id),
        error: { operation: 'submit', code: 'fixture', message: status }
      })
      await connection.send({ message: user })
      await done(events)
      expect(events.some((event) => event.type === 'error')).toBe(true)
      const edit = () =>
        messages.updateSessionMessage(input.sessionId, user.id, {
          data: { parts: [{ type: 'text', text: 'corrected' }] }
        })
      if (status === 'unknown') {
        expect(edit).toThrow()
        expect(messages.inputBinding(input.sessionId, user.id)).toBeDefined()
      } else {
        edit()
        expect(messages.getSessionMessage(input.sessionId, user.id).data.parts).toEqual([
          { type: 'text', text: 'corrected' }
        ])
        messages.deleteSessionMessage(input.sessionId, user.id)
        expect(() => messages.getSessionMessage(input.sessionId, user.id)).toThrow()
      }
      expect(script.calls).toHaveLength(0)
    }
  )

  // Catches local commands binding a product input without saving the native state needed to reopen it.
  it.each(['/goal', '/goal check the files'])(
    'persists a first local command %s before acknowledging it',
    async (command) => {
      snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'plan' }
      const first = await connect()
      const user = message(command)
      await first.connection.send({ message: user })
      await done(first.events)
      expect(first.events.filter((event) => event.type === 'error')).toEqual([])
      expect(script.calls).toHaveLength(0)
      expect(nativeFiles()).toHaveLength(1)
      const context = preparePiBranch(input.sessionId)
      expect(messages.inputBinding(input.sessionId, user.id)?.contextId).toBe(context.id)
      await first.connection.close()
      const reopened = await connect()
      expect(preparePiBranch(input.sessionId).nativeThreadId).toBe(context.nativeThreadId)
      if (command !== '/goal') {
        const handle = (reopened.connection as unknown as { handle: PiThreadHandle }).handle
        expect(JSON.stringify(handle.pi.history())).toContain('check the files')
      }
      await reopened.connection.send({ message: message('next question') })
      await done(reopened.events)
      expect(reopened.events.filter((event) => event.type === 'error')).toEqual([])
      expect(text(reopened.events)).toBe('Hello world')
      expect(nativeFiles()).toHaveLength(1)
    }
  )

  it.each(['trashed', 'deleted'] as const)('releases a settled runtime after its session is %s', async (state) => {
    const { connection, events, consuming } = await connect()
    const user = message('finish before deletion')
    await connection.send({ message: user })
    await done(events)
    const row = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, input.sessionId)).get()!
    if (state === 'deleted') dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, input.sessionId)).run()
    else
      dbh.db
        .update(agentSessionTable)
        .set({ deletedAt: Date.now() })
        .where(eq(agentSessionTable.id, input.sessionId))
        .run()
    try {
      await expect(connection.close()).resolves.toBeUndefined()
      await consuming
      await expect(connection.send({ message: user })).rejects.toThrow('unavailable')
    } finally {
      if (state === 'deleted') dbh.db.insert(agentSessionTable).values(row).run()
      else
        dbh.db.update(agentSessionTable).set({ deletedAt: null }).where(eq(agentSessionTable.id, input.sessionId)).run()
    }
  })

  it('reopens the native history without replaying archived content into the live product stream', async () => {
    const first = await connect()
    await first.connection.send({ message: message('first question') })
    await done(first.events)
    await first.connection.close()
    const reopened = await connect()
    await reopened.connection.send({ message: message('second question') })
    await done(reopened.events)
    expect(text(reopened.events)).toBe('Hello world')
    expect(JSON.stringify(script.calls[1].messages)).toContain('first question')
    expect(JSON.stringify(script.calls[1].messages)).toContain('Hello world')
    expect(nativeFiles()).toHaveLength(1)
  })

  it('executes a native tool once, projects its result, and sends it back through the model port', async () => {
    writeFileSync(join(directory, 'note.txt'), 'native tool result')
    setScript([
      assistantReply([{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'note.txt' } }], 'toolUse'),
      assistantReply([{ type: 'text', text: 'Read successfully' }])
    ])
    const { connection, events } = await connect()
    await connection.send({ message: message('read the note') })
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(text(events)).toBe('Read successfully')
    const results = projected(events).flatMap((message) =>
      message.parts.filter((part) => part.type === 'dynamic-tool' && part.state === 'output-available')
    )
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results)).toContain('native tool result')
    expect(script.calls).toHaveLength(2)
    expect(JSON.stringify(script.calls[1].messages)).toContain('native tool result')
  })

  it('rejects missing or ambiguous history without creating a replacement', async () => {
    const { connection, events } = await connect()
    await connection.send({ message: message('save history') })
    await done(events)
    await connection.close()
    const file = nativeFiles()[0]
    copyFileSync(
      application.getPath('feature.agents.pi.sessions', file),
      application.getPath('feature.agents.pi.sessions', `copy_${file}`)
    )
    await expect(connect()).rejects.toThrow('ambiguous')
    for (const file of nativeFiles()) rmSync(application.getPath('feature.agents.pi.sessions', file))
    await expect(connect()).rejects.toThrow('missing')
    expect(nativeFiles()).toEqual([])
  })

  it('never initializes a missing file for a prepared but unresolved submission', async () => {
    const user = message('uncertain dispatch')
    const context = preparePiBranch(input.sessionId)
    prepareNativeSubmission(input.sessionId, user.id, context.id, 'reject')
    expect(context.bindingState).toBe('pending')
    await expect(connect()).rejects.toThrow('missing')
    expect(nativeFiles()).toEqual([])
  })

  it('keeps a primed owner idle and permits reopen before any input has created a native file', async () => {
    const first = await connect()
    expect(first.connection.retainWhileIdle).toBe(true)
    expect(preparePiBranch(input.sessionId).bindingState).toBe('pending')
    await first.connection.close()
    const next = await connect()
    expect(nativeFiles()).toEqual([])
    expect(next.events.filter((event) => event.type === 'resume-token')).toEqual([])
  })

  it('preserves an original provider error and never announces a successful turn', async () => {
    setScript([{ ...assistantReply([], 'error'), errorMessage: 'provider unavailable' }])
    const { connection, events } = await connect()
    const user = message('question')
    await connection.send({ message: user })
    await done(events)
    expect(events.filter((event) => event.type === 'turn-complete')).toEqual([])
    expect(events.some((event) => event.type === 'error' && String(event.error).includes('provider unavailable'))).toBe(
      true
    )
  })

  it('seals admission during stop, saves the aborted input, and reopens for a new message', async () => {
    holdResponse('partial')
    const first = await connect()
    const user = message('question')
    await first.connection.send({ message: user })
    await expect.poll(() => text(first.events)).toBe('partial')
    const closing = first.connection.close()
    await expect(first.connection.send({ message: message('late') })).rejects.toThrow('unavailable')
    await closing
    expect(first.nativeInputs.some((state) => state.inputId === user.id && state.outcome === 'aborted')).toBe(true)
    expect(first.events.filter((event) => event.type === 'turn-complete')).toEqual([])
    setScript([assistantReply([{ type: 'text', text: 'resumed' }])])
    const next = await connect()
    await next.connection.send({ message: message('continue') })
    await done(next.events)
    expect(text(next.events)).toBe('resumed')
  })

  it.each(['default', 'auto'] as const)(
    'rebuilds when the gateway reasoning selection changes from %s',
    async (reasoningEffort) => {
      input.reasoningEffort = reasoningEffort
      const { connection } = await connect()
      expect(await connection.reconcile({ modelId: input.modelId, reasoningEffort })).toBe('current')
      expect(
        await connection.reconcile({
          modelId: input.modelId,
          reasoningEffort: reasoningEffort === 'auto' ? 'default' : 'auto'
        })
      ).toBe('rebuild')
    }
  )

  it('rebuilds for changed per-turn settings and rejects startup configuration drift', async () => {
    const { connection } = await connect()
    expect(await connection.reconcile({ modelId: modelId, reasoningEffort: 'high' })).toBe('rebuild')
    expect(await connection.reconcile({ modelId: modelId, fastMode: true })).toBe('rebuild')
    expect(await connection.reconcile({ modelId: modelId, serviceTier: 'flex' })).toBe('rebuild')
    await connection.close()
    mocks.prompt.mockImplementation(async () => {
      snapshot = { ...snapshot, signature: 'changed' }
      return { base: { kind: 'native' } }
    })
    await expect(connect()).rejects.toThrow('configuration changed')
  })
  it('orders steer before final input outcomes and preserves both response associations', async () => {
    const release = holdResponse('before steer')
    let reserved = false
    input.onSteerInjected = () => {
      reserved = true
    }
    const { connection, events, nativeInputs } = await connect()
    const first = message('first input')
    await connection.send({ message: first })
    await expect.poll(() => text(events)).toBe('before steer')
    const followup = message('follow up')
    expect(connection.redirect({ message: followup })).toBe(true)
    await expect
      .poll(() => nativeInputs.some((state) => state.inputId === followup.id && state.facts.includes('queued')))
      .toBe(true)
    release()
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(reserved).toBe(true)
    const boundary = events.findIndex((event) => event.type === 'steer-boundary')
    expect(text(events.slice(0, boundary))).toBe('before steer')
    expect(text(events.slice(boundary))).toBe('Hello world')
    const responses = [
      ...new Map(nativeInputs.filter((state) => state.outcome).map((state) => [state.inputId, state])).values()
    ]
    expect(responses.map((response) => response.inputId).sort()).toEqual([first.id, followup.id].sort())
    expect(responses.map((response) => response.outcome)).toEqual(['completed', 'completed'])
  })

  it('cancels queued input on stop without automatically sending it in the next owner', async () => {
    holdResponse('waiting')
    const { connection, events, nativeInputs } = await connect()
    await connection.send({ message: message('first') })
    await expect.poll(() => text(events)).toBe('waiting')
    const followup = message('never placed')
    expect(connection.redirect({ message: followup })).toBe(true)
    await expect
      .poll(() => nativeInputs.some((state) => state.inputId === followup.id && state.facts.includes('queued')))
      .toBe(true)
    await connection.close()
    expect(nativeInputs.some((state) => state.inputId === followup.id && state.outcome === 'aborted')).toBe(true)
    const saved = nativeFiles()
      .map((file) => readFileSync(application.getPath('feature.agents.pi.sessions', file), 'utf8'))
      .join('')
    expect(saved).not.toContain('never placed')
  })

  it('compacts through the Pi facet without replaying history or creating a second user input', async () => {
    mocks.binding.mockImplementation(async () => ({
      ...(await createTestBinding({
        model: MODEL,
        stream: script.model
      })),
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1 }
    }))
    const { connection, events } = await connect()
    await connection.send({ message: message('history to summarize') })
    await done(events)
    await connection.send({ message: message('another fact') })
    await expect.poll(() => events.filter((event) => event.type === 'turn-complete')).toHaveLength(2)
    const before = events.length
    const compact = message('/compact keep the important facts')
    await connection.send({ message: compact })
    await expect.poll(() => events.slice(before).some((event) => event.type === 'turn-complete')).toBe(true)
    expect(events.slice(before).filter((event) => event.type === 'error')).toEqual([])
    expect(text(events.slice(before))).toBe('')
    expect(messages.inputBinding(input.sessionId, compact.id)).toBeUndefined()
    expect(events.slice(before).some((event) => event.type === 'compaction-complete')).toBe(true)
    expect(JSON.stringify(script.calls.at(-1)!.messages)).toContain('keep the important facts')
    expect(script.calls.at(-1)!.tools).toEqual([])
  })

  it('forwards attachment paths through the input boundary while keeping input identities private', async () => {
    const attachmentPath = join(directory, 'note.txt')
    const user = messages.saveMessage({
      sessionId: input.sessionId,
      message: {
        id: uuid(),
        role: 'user',
        data: {
          parts: [
            { type: 'text', text: 'read the attachment' },
            { type: 'file', filename: 'note.txt', mediaType: 'text/plain', url: pathToFileURL(attachmentPath).href }
          ]
        }
      }
    })
    const { connection, events } = await connect()
    await connection.send({ message: user })
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(JSON.stringify(script.calls[0].messages)).toContain(JSON.stringify(attachmentPath).slice(1, -1))
    expect(messages.inputBinding(input.sessionId, user.id)?.nativeInputId).toBeDefined()
    const saved = messages.getSessionMessage(input.sessionId, user.id)
    expect(saved).not.toHaveProperty('inputContextId')
    expect(saved).not.toHaveProperty('nativeInputId')
  })

  it('blocks disabled native tools before they can modify the workspace', async () => {
    snapshot.agent.disabledTools = ['write']
    setScript([
      assistantReply(
        [{ type: 'toolCall', id: 'blocked', name: 'write', arguments: { path: 'forbidden.txt', content: 'bad' } }],
        'toolUse'
      ),
      assistantReply([{ type: 'text', text: 'Tool unavailable' }])
    ])
    const { connection, events } = await connect()
    await connection.send({ message: message('write something') })
    await done(events)
    expect(existsSync(join(directory, 'forbidden.txt'))).toBe(false)
    expect(script.calls[0].tools?.some((tool) => tool.name === 'write')).toBe(false)
    expect(text(events)).toBe('Tool unavailable')
  })

  it('does not create a missing user workspace and prepares an absent system workspace before prompt loading', async () => {
    const missing = join(directory, 'missing')
    snapshot.session.workspace.path = missing
    await expect(connect()).rejects.toThrow()
    expect(existsSync(missing)).toBe(false)
    snapshot.session.workspace.type = 'system'
    snapshot.session.workspace.path = join(
      application.getPath('feature.agents.system_workspaces'),
      '2026-10-21',
      input.sessionId
    )
    mocks.prompt.mockImplementation(async ({ workspacePath }) => {
      expect(existsSync(workspacePath)).toBe(true)
      return { base: { kind: 'custom', content: 'You are Cherry.' } }
    })
    const { connection } = await connect()
    await connection.close()
    expect(existsSync(snapshot.session.workspace.path)).toBe(true)
  })

  it('quotes login paths without replacing Pi PATH prefixes', () => {
    expect(buildPiLoginPathPrefix("/opt/homebrew/bin:/Users/o'connor/bin", 'darwin')).toBe(
      "export PATH=\"$PATH\":'/opt/homebrew/bin:/Users/o'\"'\"'connor/bin'"
    )
    expect(buildPiLoginPathPrefix('C:\\tools', 'win32')).toBeUndefined()
  })
})
