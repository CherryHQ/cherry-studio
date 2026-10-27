import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { ToolGuardInteractionState } from '@main/ai/toolApproval/toolGuards'
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
import { gate, toolCallPart } from '../../../../../packages/agent-runtime-pi/tests/subagentSupport'
import type { PiConnectionSnapshot } from '../pi/piConnectionSignature'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'

const modelId = 'test::test-model'

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
      ensureInternalGateway: async () => ({ baseUrl: 'http://gateway.invalid', apiKey: 'fixture' }),
      getAgentSessionUsageHeaders: () => ({})
    },
    McpCatalogService: { listTools: () => [] },
    AgentSessionRuntimeService: { getInteractionState: mocks.interaction }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('../pi/piConnectionSignature', () => ({
  capturePiConnectionSnapshot: mocks.capture,
  PiInvalidConnectionSnapshotError: class extends Error {}
}))
vi.mock('../pi/gatewayModelBinding', () => ({ createPiGatewayModelBinding: mocks.binding }))
vi.mock('@main/ai/runtime/agentPrompt', () => ({ buildAgentRuntimePrompt: mocks.prompt }))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({
  warmAgentMcpToolCatalogs: async () => {},
  buildAgentMcpServers: () => ({})
}))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({}), getPathFromEnvironment: () => undefined }))

// Real Runtime, native Pi and SQLite; only provider/environment configuration is substituted.
describe('desktop Pi Durable connection', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let input: AgentRuntimeConnectInput
  let snapshot: PiConnectionSnapshot
  let script: ReturnType<typeof scriptedModel>
  const connections: PiDurableRuntimeConnection[] = []

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
        type: 'pi-durable',
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
      enabledApiKeys: [],
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
    const connection = await new PiDurableRuntimeConnection(input).start()
    connections.push(connection)
    const events: AgentRuntimeEvent[] = []
    const consuming = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    return { connection, events, consuming }
  }
  async function done(events: AgentRuntimeEvent[]) {
    await expect.poll(() => events.some((event) => event.type === 'turn-complete' || event.type === 'error')).toBe(true)
  }
  const text = (events: AgentRuntimeEvent[]) =>
    events
      .flatMap((event) => (event.type === 'chunk' && event.chunk.type === 'text-delta' ? [event.chunk.delta] : []))
      .join('')
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
    await expect.poll(() => approvals().length).toBe(1)
    expect(existsSync(join(directory, 'original.txt'))).toBe(false)
    expect(approvals()[0].request.toolCallId).toBe('write')
    toolApprovalRegistry.dispatch(approvals()[0].request.approvalId, {
      approved: true,
      updatedInput: { path: 'approved.txt', content: 'approved' }
    })
    await expect.poll(() => approvals().length).toBe(2)
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

  it('streams incrementally and reopens the same SQLite conversation without replaying old text', async () => {
    setScript([assistantReply('first streaming answer')])
    const finish = holdResponse('first streaming answer')
    const first = await connect()
    const user = message('first')
    await first.connection.send({ message: user })
    await expect.poll(() => text(first.events).length).toBeGreaterThan(0)
    expect(first.events.some((event) => event.type === 'turn-complete')).toBe(false)
    finish()
    await done(first.events)
    expect(text(first.events)).toBe('first streaming answer')
    expect(first.events.filter((event) => event.type === 'error')).toEqual([])
    const context = contexts.prepareDurableBranch(input.sessionId)
    expect(messages.readSubmission(input.sessionId, user.id).submission.outcome).toBe('completed')
    await first.connection.close()
    setScript([assistantReply('second answer')])
    const second = await connect()
    await second.connection.send({ message: message('second') })
    await done(second.events)
    expect(text(second.events)).toBe('second answer')
    expect(contexts.prepareDurableBranch(input.sessionId).nativeThreadId).toBe(context.nativeThreadId)
    expect(JSON.stringify(script.calls[0].messages)).toContain('first streaming answer')
  })

  it('places a late steer as the next input before its model call and records both outcomes', async () => {
    setScript([assistantReply('next answer')])
    const finish = holdResponse('first answer')
    let injected = false
    input.onSteerInjected = () => {
      injected = true
    }
    const fallback = script.model
    script.model = (model, context, options) => {
      const steering = JSON.stringify(context.messages).includes('late correction')
      if (steering && !injected) throw new Error('Model request preceded steer placement')
      return fallback(model, context, options)
    }
    const { connection, events } = await connect()
    const first = message('first')
    await connection.send({ message: first })
    await expect.poll(() => text(events)).toBe('first answer')
    finish()
    const late = message('late correction')
    expect(connection.redirect({ message: late })).toBe(true)
    await expect.poll(() => messages.readSubmission(input.sessionId, late.id).submission.outcome).toBe('completed')
    expect(messages.readSubmission(input.sessionId, first.id).submission.outcome).toBe('completed')
    expect(injected).toBe(true)
    expect(text(events)).toBe('first answernext answer')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  it('keeps background output in its own projection and accepts a later message in the same child', async () => {
    const held = gate()
    let root = ''
    let child = ''
    let childRuns = 0
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) {
        child = call.sessionId!
        childRuns++
        return childRuns === 1
          ? held.wait(assistantReply('child first answer'))
          : assistantReply('child continued answer')
      }
      if (!call.messages.some((entry) => entry.role === 'toolResult'))
        return assistantReply(
          [
            toolCallPart('spawn', 'subagent', {
              description: 'research',
              prompt: 'child work',
              background: true,
              fork: false
            })
          ],
          'toolUse'
        )
      return assistantReply('parent done')
    })
    const { connection, events } = await connect()
    const user = message('delegate')
    await connection.send({ message: user })
    await held.reached
    await done(events)
    const view = await connection.childProjection('spawn')
    expect(view).toBeDefined()
    expect(text(events)).not.toContain('child first')
    held.open()
    await expect.poll(() => JSON.stringify(view!.snapshot().messages)).toContain('child first answer')
    await expect.poll(() => view!.snapshot().active).toBe(false)
    const contextId = view!.snapshot().contextId
    const childIdentity = contexts.context(contextId).nativeThreadId
    await connection.messageChild(contextId, 'continue research')
    await expect.poll(() => JSON.stringify(view!.snapshot().messages)).toContain('child continued answer')
    expect(contexts.context(contextId).nativeThreadId).toBe(childIdentity)
    expect(child).not.toBe(root)
    expect(text(events)).not.toContain('child continued answer')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(events.flatMap((event) => (event.type === 'input-response' ? [event.input.inputId] : []))).toEqual([user.id])
    await connection.close()
    const reopened = await connect()
    const restored = await reopened.connection.childProjection('spawn')
    expect(restored?.snapshot().contextId).toBe(contextId)
    expect(JSON.stringify(restored?.snapshot().messages)).toContain('child continued answer')
    expect(reopened.events.filter((event) => event.type === 'input-response')).toEqual([])
  })

  it.each(['shutdown', 'stop'] as const)('distinguishes %s from durable cancellation', async (action) => {
    const held = gate()
    script = respondingModel(() => held.wait(assistantReply('unfinished')))
    const first = await connect()
    const user = message('work')
    await first.connection.send({ message: user })
    await held.reached
    if (action === 'stop') await first.connection.interrupt()
    await first.connection.close()
    setScript([assistantReply('recovered answer')])
    const reopened = await connect()
    if (action === 'shutdown') {
      await done(reopened.events)
      expect(text(reopened.events)).toBe('recovered answer')
    } else {
      await reopened.connection.close()
      expect(script.calls).toHaveLength(0)
      expect(messages.readSubmission(input.sessionId, user.id).submission.outcome).toBe('aborted')
    }
  })

  it('persists cancellation during a native tool and does not continue after reopen', async () => {
    setScript([
      assistantReply(
        [
          toolCallPart('bash', 'bash', {
            command: 'echo ready > started.txt; /bin/sleep 30; echo late > completed.txt'
          })
        ],
        'toolUse'
      ),
      assistantReply('must not run')
    ])
    const { connection, events } = await connect()
    const user = message('run a tool')
    await connection.send({ message: user })
    await expect.poll(() => existsSync(join(directory, 'started.txt'))).toBe(true)
    await connection.interrupt()
    await connection.close()
    expect(messages.readSubmission(input.sessionId, user.id).submission.outcome).toBe('aborted')
    expect(existsSync(join(directory, 'completed.txt'))).toBe(false)
    expect(text(events)).not.toContain('must not run')
    setScript([assistantReply('must not resume')])
    const reopened = await connect()
    await reopened.connection.close()
    expect(script.calls).toHaveLength(0)
  })
})
