import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createAssistantMessageEventStream, type AssistantMessage, type Usage } from '@earendil-works/pi-ai'
import { AgentDoc, configure, createSession, type ConversationId } from '@earendil-works/pi-durable'
import { trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { runtimeId, type InputState } from '@cherrystudio/agent-runtime'
import type { DurableObservation, PiDurableThreadHandle } from '@cherrystudio/agent-runtime-pi-durable'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { savedChildView } from '@main/ai/agentSession/ChildThreadProjection'
import { openDurableStorage } from '@main/ai/agentSession/durableNativeContext'
import { AgentSessionForkOperations } from '@main/ai/agentSession/fork/AgentSessionForkOperations'
import { readForkResources } from '@main/ai/agentSession/fork/resources'
import { bindNativeInput, prepareNativeSubmission } from '@main/ai/agentSession/nativeSubmission'
import { ThreadMessageProjection } from '@main/ai/agentSession/ThreadMessageProjection'
import { getPiTraceContext, observabilitySinks } from '@main/ai/observability'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { ToolGuardInteractionState } from '@main/ai/toolApproval/toolGuards'
import { getShellEnv } from '@main/utils/shellEnv'
import { ModelSchema } from '@shared/data/types/model'
import { ProviderSchema } from '@shared/data/types/provider'
import type { SpanEntity } from '@shared/data/types/trace'

import {
  assistantReply,
  createTestBinding,
  MODEL,
  scriptedModel,
  respondingModel,
  tempDir
} from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { gate, toolCallPart } from '../../../../../packages/agent-runtime-pi/tests/subagentSupport'
import { PiInvalidConnectionSnapshotError, type PiConnectionSnapshot } from '../pi/piConnectionSignature'
import { runtimeDriverRegistry } from '../registry'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import { allocateDurableBackendTx, prepareDurableBranch, reserveDurableBranchTx } from './durableContext'
import type { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'
import { PiDurableRuntimeDriver } from './PiDurableRuntimeDriver'

const modelId = 'test::test-model'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  binding: vi.fn(),
  prompt: vi.fn(),
  interaction: vi.fn<() => ToolGuardInteractionState>(),
  delegated: vi.fn(),
  prime: vi.fn()
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
    AgentSessionRuntimeService: { getInteractionState: mocks.interaction, primeConnection: mocks.prime }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('../pi/piConnectionSignature', () => ({
  capturePiConnectionSnapshot: mocks.capture,
  PiInvalidConnectionSnapshotError: class extends Error {
    constructor(
      message: string,
      readonly reason: 'reassigned' | 'unavailable' = 'unavailable'
    ) {
      super(message)
    }
  }
}))
vi.mock('../pi/gatewayModelBinding', () => ({ createPiGatewayModelBinding: mocks.binding }))
vi.mock('@main/ai/runtime/agentPrompt', () => ({ buildAgentRuntimePrompt: mocks.prompt }))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({
  warmAgentMcpToolCatalogs: async () => {},
  buildAgentMcpServers: () => ({})
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn(async (): Promise<Record<string, string>> => ({})),
  getPathFromEnvironment: () => undefined
}))

// Real Runtime, native Pi and SQLite; only provider/environment configuration is substituted.
describe('desktop Pi Durable connection', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let input: AgentRuntimeConnectInput
  let snapshot: PiConnectionSnapshot
  let script: ReturnType<typeof scriptedModel>
  const connections: PiDurableRuntimeConnection[] = []
  let driver: PiDurableRuntimeDriver

  beforeEach(async () => {
    driver = new PiDurableRuntimeDriver()
    vi.mocked(getShellEnv).mockReset()
    mocks.interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    mocks.delegated.mockClear()
    mocks.prime.mockReset()
    directory = await realpath(tempDir('desktop-pi'))
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
    runtimeDriverRegistry.clearForTest()
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
  function sharedHosts() {
    dbh.db.insert(userProviderTable).values({ providerId: 'test', name: 'Test', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: modelId,
        providerId: 'test',
        modelId: 'test-model',
        name: 'Test',
        capabilities: ['function-call'],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db.update(agentTable).set({ model: modelId }).where(eq(agentTable.id, input.agentId)).run()
    mocks.capture.mockImplementation(async (nextSession: string) => ({
      ...snapshot,
      session: agentSessionService.getById(nextSession)
    }))
    mocks.binding.mockImplementation(async (next: AgentRuntimeConnectInput, _provider, _model, _usage, shared) => {
      const model = { ...MODEL, provider: next.sessionId }
      if (!shared) return createTestBinding({ model, stream: (m, c, o) => script.model(m, c, o) })
      shared.registerProvider(model.provider, {
        api: model.api,
        apiKey: 'fixture',
        baseUrl: model.baseUrl,
        models: [model],
        streamSimple: (m, c, o) => script.model(m, c, o)
      })
      return { modelRuntime: shared, model: shared.getModel(model.provider, model.id)! }
    })
    runtimeDriverRegistry.register(driver)
  }
  async function savedAnswer(current: Awaited<ReturnType<typeof connect>>) {
    await done(current.events)
    const complete = current.events.findLast((event) => event.type === 'turn-complete')!
    if (complete.type !== 'turn-complete' || !complete.forkAnchor) throw new Error('Missing committed checkpoint')
    return messages.saveMessage({
      sessionId: input.sessionId,
      nativeContextId: current.connection.contextId,
      runtimeResumeToken: current.handle.thread.id,
      runtimeAnchor: complete.forkAnchor,
      message: {
        id: uuid(),
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: text(current.events) }] }
      }
    })
  }

  async function editInput(messageId: string, replacement: string, fail?: 'close' | 'commit') {
    const target = { messageId, version: messages.readEditSnapshotTx(dbh.db, input.sessionId, messageId).version }
    return new AgentSessionForkOperations().edit(
      input.sessionId,
      target,
      async () => {
        if (fail === 'close') throw new Error('close failed')
        for (const connection of connections) await connection.close()
      },
      (tx, nativeId, contextId) => {
        const [row] = messages.saveMessagesTx(tx, {
          sessionId: input.sessionId,
          messages: [{ role: 'user', status: 'success', data: { parts: [{ type: 'text', text: replacement }] } }]
        })
        reserveDurableBranchTx(tx, input.sessionId, row.id, nativeId, contextId)
        if (contextId) messages.setEditRuntimeTx(tx, input.sessionId, row.id, nativeId)
        if (fail === 'commit') throw new Error('product commit failed')
        return row
      }
    )
  }

  // Editing the first input must neither recover its original prompt nor guess a numeric native identity.
  it('edits the first input into a fresh durable context and survives reopening', async () => {
    sharedHosts()
    const parent = await connect()
    const old = message('original first input')
    await parent.connection.send({ message: old })
    await savedAnswer(parent)
    const original = contexts.context(parent.connection.contextId!)
    writeFileSync(join(directory, 'keep.txt'), 'current files')
    const calls = script.calls.length
    const edited = await editInput(old.id, 'replacement first input')
    const target = prepareDurableBranch(input.sessionId, edited.id)
    expect(target.backendId).not.toBe(original.backendId)
    expect(target.nativeThreadId).toBeNull()
    expect(messages.readEditSnapshotTx(dbh.db, input.sessionId, edited.id).user.data.nativeSessionId).toBeUndefined()
    expect(script.calls).toHaveLength(calls)
    expect(messages.listSessionMessages(input.sessionId).items.map((row) => row.id)).toEqual([edited.id])
    expect(() => messages.getSessionMessage(input.sessionId, old.id)).toThrow()
    input = { ...input, branchHead: edited.id }
    const fresh = await connect()
    expect(fresh.connection.contextId).toBe(target.id)
    setScript([assistantReply('replacement answer')])
    await fresh.connection.send({ message: edited })
    const answer = await savedAnswer(fresh)
    expect(JSON.stringify(script.calls[0].messages)).toContain('replacement first input')
    expect(JSON.stringify(script.calls[0].messages)).not.toContain('original first input')
    expect(readFileSync(join(directory, 'keep.txt'), 'utf8')).toBe('current files')
    await fresh.connection.close()
    input = { ...input, branchHead: answer.id }
    const reopened = await connect()
    expect(reopened.connection.contextId).toBe(target.id)
    expect(reopened.handle.thread.id).toBe(fresh.handle.thread.id)
    setScript([assistantReply('continued replacement')])
    await reopened.connection.send({ message: message('continue edited context') })
    await savedAnswer(reopened)
    expect(JSON.stringify(script.calls[0].messages)).toContain('replacement first input')
    expect(JSON.stringify(script.calls[0].messages)).not.toContain('original first input')
  })

  // A second edit must use the first edit's remapped prefix without changing shared product rows.
  it('replaces a committed tail repeatedly and reopens only the edited context', async () => {
    sharedHosts()
    const parent = await connect()
    await parent.connection.send({ message: message('shared first input') })
    const shared = await savedAnswer(parent)
    const original = contexts.context(parent.connection.contextId!)
    const old = message('original later question')
    parent.events.length = 0
    setScript([assistantReply('original later answer')])
    await parent.connection.send({ message: old })
    await savedAnswer(parent)
    const before = messages.getSessionMessage(input.sessionId, shared.id)
    const edited = await editInput(old.id, 'edited later question')
    input = { ...input, branchHead: edited.id }
    const first = await connect()
    const firstContext = contexts.context(first.connection.contextId!)
    expect(firstContext.backendId).toBe(original.backendId)
    expect(first.handle.thread.id).not.toBe(original.nativeThreadId)
    setScript([assistantReply('edited later answer')])
    await first.connection.send({ message: edited })
    await savedAnswer(first)
    expect(JSON.stringify(script.calls[0].messages)).toContain('shared first input')
    expect(JSON.stringify(script.calls[0].messages)).not.toContain('original later question')
    expect(JSON.stringify(script.calls[0].messages)).not.toContain('original later answer')
    const repeated = await editInput(edited.id, 'second edited question')
    input = { ...input, branchHead: repeated.id }
    const second = await connect()
    expect(second.handle.thread.id).not.toBe(first.handle.thread.id)
    setScript([assistantReply('second edited answer')])
    await second.connection.send({ message: repeated })
    const final = await savedAnswer(second)
    expect(JSON.stringify(script.calls[0].messages)).not.toContain('edited later question')
    expect(messages.getSessionMessage(input.sessionId, shared.id)).toEqual(before)
    const calls = script.calls.length
    const fork = await new AgentSessionForkOperations().fork(input.sessionId, final.id)
    expect(messages.listSessionMessages(fork).items).toHaveLength(4)
    expect(script.calls).toHaveLength(calls)
    await second.connection.close()
    expect(() => messages.getSessionMessage(input.sessionId, old.id)).toThrow()
    expect(() => messages.getSessionMessage(input.sessionId, edited.id)).toThrow()
    input = { ...input, branchHead: final.id }
    const reopened = await connect()
    expect(reopened.handle.thread.id).toBe(second.handle.thread.id)
    setScript([assistantReply('edited branch continued')])
    await reopened.connection.send({ message: message('continue edited context') })
    await savedAnswer(reopened)
    expect(JSON.stringify(script.calls[0].messages)).not.toContain('original later question')
    expect(JSON.stringify(script.calls[0].messages)).toContain('second edited question')
  })

  // Prepared native forks must stay inert when close, publication, or receipt delivery fails.
  it.each(['close', 'commit', 'receipt'] as const)(
    'keeps the original durable branch after failed edit: %s',
    async (fail) => {
      sharedHosts()
      const parent = await connect()
      const initial = message('shared failure boundary')
      await parent.connection.send({ message: initial })
      await savedAnswer(parent)
      const old = message('original failure input')
      parent.events.length = 0
      await parent.connection.send({ message: old })
      const answer = await savedAnswer(parent)
      const other = messages.saveMessage({
        sessionId: input.sessionId,
        parentId: messages.readEditSnapshotTx(dbh.db, input.sessionId, initial.id).user.parentId!,
        message: { role: 'user', data: { parts: [] } }
      })
      const collision = contexts.reserveBranchTx(dbh.db, {
        sessionId: input.sessionId,
        backendId: allocateDurableBackendTx(dbh.db).id,
        anchorMessageId: other.id,
        nativeThreadId: '2'
      })
      contexts.bindContext(collision.id, '2')
      messages.selectBranch(input.sessionId, answer.id)
      const before = messages.listSessionMessages(input.sessionId).items
      if (fail === 'receipt') {
        const runtime = parent.connection['runtime']!
        const commit = runtime.durable.commit.bind(runtime.durable)
        vi.spyOn(runtime.durable, 'commit').mockImplementationOnce(async (...args) => {
          await commit(...args)
          throw new Error('receipt lost')
        })
      }
      await expect(editInput(old.id, 'unpublished replacement', fail === 'receipt' ? undefined : fail)).rejects.toThrow(
        fail === 'receipt' ? 'receipt lost' : fail === 'close' ? 'close failed' : 'product commit failed'
      )
      expect(messages.listSessionMessages(input.sessionId).items).toEqual(before)
      const records = await readForkResources()
      expect(records).toHaveLength(1)
      expect(records[0].nativeDisposition).toBe('retained')
      const prepared = records[0].nativePreparations![0]
      expect(contexts.roots(prepared.backendId).some((context) => context.id === prepared.contextId)).toBe(false)
      const calls = script.calls.length
      await new AgentSessionForkOperations().recover()
      expect(script.calls).toHaveLength(calls)
      for (const connection of connections) await connection.close()
      input = { ...input, branchHead: answer.id }
      const reopened = await connect()
      setScript([assistantReply('original survived edit failure')])
      await reopened.connection.send({ message: message('continue after failure') })
      await savedAnswer(reopened)
      expect(text(reopened.events)).toContain('original survived edit failure')
    }
  )

  it('forks a committed prefix in the shared owner and survives source deletion and a cold reopen', async () => {
    sharedHosts()
    const sourceId = input.sessionId
    const parent = await connect()
    await parent.connection.send({ message: message('remember original') })
    const answer = await savedAnswer(parent)
    const forkId = await new AgentSessionForkOperations().fork(sourceId, answer.id)
    const forkContext = prepareDurableBranch(forkId)
    expect(forkContext.backendId).toBe(prepareDurableBranch(sourceId).backendId)
    expect(forkContext.nativeThreadId).not.toBe(parent.handle.thread.id)
    const runtime = parent.connection['runtime']!
    setScript([assistantReply('later source answer')])
    parent.events.length = 0
    await parent.connection.send({ message: message('source only later') })
    await done(parent.events)
    input = { ...input, sessionId: forkId }
    const child = await connect()
    expect(child.connection['runtime']).toBe(runtime)
    const inherited = await runtime.durable.commit(
      async (tx) =>
        (
          await tx.scanEntries(
            { conversationId: Number(child.handle.thread.id) as ConversationId, order: 'ascending' },
            256
          )
        ).items,
      BACKGROUND_CONTEXT
    )
    expect(JSON.stringify(inherited)).toContain('remember original')
    expect(JSON.stringify(inherited)).not.toContain('source only later')
    setScript([assistantReply('fork independent answer')])
    await parent.connection.close()
    await child.connection.send({ message: message('fork followup') })
    await done(child.events)
    expect(text(child.events)).toContain('fork independent answer')
    expect(child.events.filter((event) => event.type === 'error')).toEqual([])
    await child.connection.close()
    dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, sourceId)).run()
    const reopened = await connect()
    expect(reopened.connection['runtime']).not.toBe(runtime)
    setScript([assistantReply('surviving fork answer')])
    await reopened.connection.send({ message: message('after source purge') })
    await done(reopened.events)
    expect(text(reopened.events)).toContain('surviving fork answer')
    const older = messages.listSessionMessages(forkId).items.find((row) => row.role === 'assistant')!
    const secondFork = await new AgentSessionForkOperations().fork(forkId, older.id)
    expect(prepareDurableBranch(secondFork).backendId).toBe(forkContext.backendId)
    expect(reopened.events.filter((event) => event.type === 'error')).toEqual([])
  })

  it('routes concurrent roots to their own workspace, approval channel and model registration', async () => {
    sharedHosts()
    const sourceId = input.sessionId
    const workspace = join(application.getPath('feature.agents.system_workspaces'), 'source-workspace')
    mkdirSync(workspace)
    const workspaceId = snapshot.session.workspace.id
    dbh.db
      .update(agentWorkspaceTable)
      .set({ path: workspace, type: 'system' })
      .where(eq(agentWorkspaceTable.id, workspaceId))
      .run()
    snapshot.agent.configuration = { permission_mode: 'default' }
    const parent = await connect()
    await parent.connection.send({ message: message('initial boundary') })
    const answer = await savedAnswer(parent)
    const forkId = await new AgentSessionForkOperations().fork(sourceId, answer.id)
    const forkWorkspace = agentSessionService.getById(forkId).workspace.path
    input = { ...input, sessionId: forkId }
    const child = await connect()
    expect(child.connection['runtime']).toBe(parent.connection['runtime'])
    script = respondingModel((call) =>
      call.messages.some((item) => item.role === 'toolResult')
        ? assistantReply('write complete')
        : assistantReply(
            [toolCallPart('write-own', 'write', { path: 'ownership.txt', content: call.model.provider })],
            'toolUse'
          )
    )
    parent.events.length = 0
    await Promise.all([
      parent.connection.send({
        message: messages.saveMessage({
          sessionId: sourceId,
          message: { id: uuid(), role: 'user', data: { parts: [{ type: 'text', text: 'write parent' }] } }
        })
      }),
      child.connection.send({ message: message('write fork') })
    ])
    const approvals = (events: AgentRuntimeEvent[]) => events.filter((event) => event.type === 'tool-approval-request')
    await expect.poll(() => approvals(parent.events).length + approvals(child.events).length).toBe(2)
    expect(approvals(parent.events)).toHaveLength(1)
    expect(approvals(child.events)).toHaveLength(1)
    expect(approvals(parent.events)[0].request.approvalId).not.toBe(approvals(child.events)[0].request.approvalId)
    toolApprovalRegistry.dispatch(approvals(parent.events)[0].request.approvalId, { approved: true })
    await done(parent.events)
    expect(existsSync(join(forkWorkspace, 'ownership.txt'))).toBe(false)
    expect(readFileSync(join(workspace, 'ownership.txt'), 'utf8')).toBe(sourceId)
    toolApprovalRegistry.dispatch(approvals(child.events)[0].request.approvalId, { approved: true })
    await done(child.events)
    expect(readFileSync(join(forkWorkspace, 'ownership.txt'), 'utf8')).toBe(forkId)
    expect([...parent.events, ...child.events].filter((event) => event.type === 'error')).toEqual([])
  })

  it('forks history spanning stores whose native conversation IDs are equal', async () => {
    sharedHosts()
    const first = await connect()
    await first.connection.send({ message: message('old context input') })
    await savedAnswer(first)
    const old = contexts.context(first.connection.contextId!)
    await first.connection.close()
    const nextInput = message('new context input')
    const next = application.get('DbService').withWriteTx((tx) =>
      contexts.reserveBranchTx(tx, {
        sessionId: input.sessionId,
        backendId: allocateDurableBackendTx(tx).id,
        anchorMessageId: nextInput.id
      })
    )
    input = { ...input, branchHead: nextInput.id }
    const current = await connect()
    await current.connection.send({ message: nextInput })
    const answer = await savedAnswer(current)
    expect(current.handle.thread.id).toBe(old.nativeThreadId)
    expect(next.backendId).not.toBe(old.backendId)
    const calls = script.calls.length
    const fork = await new AgentSessionForkOperations().fork(input.sessionId, answer.id)
    expect(messages.listSessionMessages(fork).items).toHaveLength(4)
    expect(contexts.roots(old.backendId).some((context) => context.sessionId === fork)).toBe(true)
    expect(contexts.roots(next.backendId).some((context) => context.sessionId === fork)).toBe(true)
    expect(script.calls).toHaveLength(calls)
  })

  it('reconciles a cold native fork without resuming work or losing historical configuration', async () => {
    sharedHosts()
    const parent = await connect()
    await parent.connection.send({ message: message('checkpoint') })
    const answer = await savedAnswer(parent)
    const checkpoint = parent.events.findLast((event) => event.type === 'turn-complete')!
    if (checkpoint.type !== 'turn-complete') throw new Error('Missing completion')
    await parent.connection['runtime']!.durable.commit(
      (tx) =>
        configure(tx, Number(parent.handle.thread.id) as ConversationId, { instructions: 'future configuration' }),
      BACKGROUND_CONTEXT
    )
    await parent.connection.close()
    const request = {
      sourceSessionId: input.sessionId,
      sourceBackendId: prepareDurableBranch(input.sessionId).backendId,
      checkpoint: checkpoint.forkAnchor!.checkpoint,
      checkpoints: [checkpoint.forkAnchor!.checkpoint],
      targetSessionId: uuid(),
      targetCwd: directory,
      artifactDirectory: directory,
      signal: new AbortController().signal
    }
    const calls = script.calls.length
    const [first, repeated] = await Promise.all([driver.fork(request), driver.fork(request)])
    expect(repeated.resumeToken).toBe(first.resumeToken)
    expect(script.calls).toHaveLength(calls)
    const native = createSession(await openDurableStorage(contexts.backend(request.sourceBackendId)))
    try {
      expect(
        (await native.snapshot(AgentDoc, Number(first.resumeToken) as ConversationId, BACKGROUND_CONTEXT))?.instructions
      ).not.toBe('future configuration')
    } finally {
      await native.close(BACKGROUND_CONTEXT)
    }
    await expect(driver.fork({ ...request, sourceBackendId: uuid() })).rejects.toThrow('unsupported_checkpoint')
    const forkId = await new AgentSessionForkOperations().fork(input.sessionId, answer.id)
    input = { ...input, sessionId: forkId }
    const fork = await connect()
    const agent = await fork.connection['runtime']!.durable.commit(
      async (tx) => ({ ...(await tx.doc(AgentDoc, Number(fork.handle.thread.id) as ConversationId)) }),
      BACKGROUND_CONTEXT
    )
    expect(agent.cwd).toBe(directory)
  })

  it('recovers an uncertain native commit and serializes final close against a new access', async () => {
    sharedHosts()
    const parent = await connect()
    await parent.connection.send({ message: message('fork boundary') })
    await savedAnswer(parent)
    const complete = parent.events.findLast((event) => event.type === 'turn-complete')!
    if (complete.type !== 'turn-complete') throw new Error('Missing completion')
    const checkpoint = complete.forkAnchor!.checkpoint
    const request = {
      sourceSessionId: input.sessionId,
      sourceBackendId: prepareDurableBranch(input.sessionId).backendId,
      checkpoint,
      checkpoints: [checkpoint],
      targetSessionId: uuid(),
      targetCwd: directory,
      artifactDirectory: directory,
      signal: new AbortController().signal
    }
    const runtime = parent.connection['runtime']!
    const commit = runtime.durable.commit.bind(runtime.durable)
    vi.spyOn(runtime.durable, 'commit').mockImplementationOnce(async (...args) => {
      await commit(...args)
      throw new Error('native receipt lost')
    })
    await expect(driver.fork(request)).rejects.toThrow('native receipt lost')
    const recovered = await driver.fork(request)
    expect((await driver.fork(request)).resumeToken).toBe(recovered.resumeToken)
    const cancelled = new AbortController()
    cancelled.abort(new Error('cancelled fork'))
    await expect(driver.fork({ ...request, targetSessionId: uuid(), signal: cancelled.signal })).rejects.toThrow(
      'cancelled fork'
    )
    const closing = parent.connection.close()
    const opening = connect()
    await closing
    const next = await opening
    expect(next.connection['runtime']).not.toBe(runtime)
    setScript([assistantReply('after close race')])
    await next.connection.send({ message: message('new owner') })
    await done(next.events)
    expect(text(next.events)).toContain('after close race')
    expect(next.events.filter((event) => event.type === 'error')).toEqual([])
  })

  it('attaches a pending peer before shared recovery and restores its frozen request settings', async () => {
    sharedHosts()
    input = { ...input, reasoningEffort: 'high', fastMode: true }
    const sourceInput = { ...input }
    const parent = await connect()
    await parent.connection.send({ message: message('initial boundary') })
    const answer = await savedAnswer(parent)
    const forkId = await new AgentSessionForkOperations().fork(input.sessionId, answer.id)
    const held = gate()
    script = respondingModel(() => held.wait(assistantReply('unfinished source answer')))
    parent.events.length = 0
    await parent.connection.send({ message: message('pending source input') })
    await held.reached
    await parent.connection.close()
    const recoveredEvents: AgentRuntimeEvent[] = []
    let recovered: PiDurableRuntimeConnection | undefined
    mocks.binding.mockImplementation(async (next: AgentRuntimeConnectInput, _provider, _model, _usage, shared) => {
      const model = { ...MODEL, provider: next.sessionId }
      const stream = respondingModel(() =>
        assistantReply(`${next.sessionId}:${next.reasoningEffort}:${next.fastMode}`)
      ).model
      if (!shared) return createTestBinding({ model, stream })
      shared.registerProvider(model.provider, {
        api: model.api,
        apiKey: 'fixture',
        baseUrl: model.baseUrl,
        models: [model],
        streamSimple: stream
      })
      return { modelRuntime: shared, model: shared.getModel(model.provider, model.id)! }
    })
    mocks.prime.mockImplementation(async (sessionId: string) => {
      recovered = await driver.connect({ sessionId, agentId: sourceInput.agentId, modelId })
      connections.push(recovered)
      void (async () => {
        for await (const event of recovered.events) recoveredEvents.push(event)
      })()
    })
    input = { ...input, sessionId: forkId, reasoningEffort: 'low', fastMode: false }
    const fork = await connect()
    await expect.poll(() => recoveredEvents.some((event) => event.type === 'turn-complete')).toBe(true)
    expect(text(recoveredEvents)).toContain(`${sourceInput.sessionId}:high:true`)
    expect(recovered!['runtime']).toBe(fork.connection['runtime'])
    await fork.connection.send({ message: message('independent fork input') })
    await done(fork.events)
    expect(text(fork.events)).toContain(`${forkId}:low:false`)
    expect([...recoveredEvents, ...fork.events].filter((event) => event.type === 'error')).toEqual([])
    held.open()
  })

  it('retains an identifiable inert native preparation when product publication fails', async () => {
    sharedHosts()
    const parent = await connect()
    await parent.connection.send({ message: message('publication boundary') })
    const answer = await savedAnswer(parent)
    const before = dbh.db.select().from(agentSessionTable).all().length
    dbh.sqlite.exec(
      "CREATE TRIGGER reject_durable_fork BEFORE INSERT ON agent_session_message WHEN NEW.session_id != '" +
        input.sessionId +
        "' BEGIN SELECT RAISE(ABORT, 'publication failed'); END"
    )
    try {
      await expect(new AgentSessionForkOperations().fork(input.sessionId, answer.id)).rejects.toThrow(
        'publication failed'
      )
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_durable_fork')
    }
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(before)
    const records = await readForkResources()
    expect(records).toEqual([
      expect.objectContaining({
        nativeDisposition: 'retained',
        nativePreparations: [expect.objectContaining({ backendId: prepareDurableBranch(input.sessionId).backendId })]
      })
    ])
    const calls = script.calls.length
    await new AgentSessionForkOperations().recover()
    await parent.connection.drainChildWrites()
    expect(script.calls).toHaveLength(calls)
    parent.events.length = 0
    setScript([assistantReply('source remains usable')])
    await parent.connection.send({ message: message('continue source') })
    await done(parent.events)
    expect(text(parent.events)).toContain('source remains usable')
  })

  it('uses native Durable tool phases and forwards the generation phase parent', async () => {
    const captured: SpanEntity[] = []
    const provider = new BasicTracerProvider()
    vi.spyOn(trace, 'getTracer').mockImplementation((name) => provider.getTracer(name))
    const preferences = application.get('PreferenceService')
    const previous = preferences.get('app.developer_mode.enabled')
    await preferences.set('app.developer_mode.enabled', true)
    observabilitySinks.register({
      id: 'durable-native-test',
      writeSpanEntity: (span) => {
        captured.push(span)
      }
    })
    input.trace = {
      topicId: `agent-session:${input.sessionId}`,
      sessionId: input.sessionId,
      turnId: 'native-turn',
      traceId: '11111111111111111111111111111111',
      rootSpanId: '2222222222222222'
    }
    setScript([
      {
        ...assistantReply(''),
        content: [toolCallPart('native-tool', 'bash', { command: 'printf native-telemetry' })],
        stopReason: 'toolUse'
      },
      assistantReply('finished')
    ])
    const parents: ReturnType<typeof getPiTraceContext>[] = []
    const original = script.model
    script.model = (model, context, options) => {
      parents.push(getPiTraceContext(options?.telemetry))
      return original(model, context, options)
    }
    try {
      const current = await connect()
      await current.connection.send({ message: message('run a tool') })
      await done(current.events)
      await current.connection.close()
      expect(text(current.events)).toContain('finished')
      const submission = captured.find((span) => span.name === 'pi.durable.submit')
      expect(submission).toMatchObject({ traceId: input.trace.traceId, parentId: input.trace.rootSpanId })
      const tool = captured.find((span) => span.attributes?.['tool.call_id'] === 'native-tool')
      expect(tool).toMatchObject({
        name: 'pi.durable.phase',
        status: 'OK',
        attributes: { 'tool.name': 'bash', outcome: 'done' }
      })
      expect(tool?.events?.some((event) => event.name === 'pi.durable.entry')).toBe(true)
      expect(parents).toHaveLength(2)
      for (const parent of parents) {
        expect(parent).toMatchObject({ sessionId: input.sessionId, traceId: input.trace.traceId })
        expect(captured.find((span) => span.id === parent?.rootSpanId)?.name).toBe('pi.durable.phase')
      }
      expect(
        captured.some((span) =>
          ['pi.generate_content', 'pi.execute_tool', 'pi.ai.request', 'pi.ai.poll'].includes(span.name)
        )
      ).toBe(false)
    } finally {
      await preferences.set('app.developer_mode.enabled', previous)
      await provider.shutdown()
    }
  })

  function message(text: string) {
    return messages.saveMessage({
      sessionId: input.sessionId,
      message: { id: uuid(), role: 'user', data: { parts: [{ type: 'text', text }] } }
    })
  }
  async function connect() {
    const connection = await driver.connect(input)
    connections.push(connection)
    const nativeInputs: InputState[] = []
    const handle = (connection as unknown as { handle: PiDurableThreadHandle }).handle
    await handle.observe((event) => {
      if (event.type === 'snapshot') nativeInputs.push(...event.inputs)
      if (event.type === 'input.changed') nativeInputs.push(event.input)
    })
    const events: AgentRuntimeEvent[] = []
    const consuming = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    return { connection, events, consuming, nativeInputs, handle }
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
  it('exposes the frozen owner it was spawned under', async () => {
    const { connection } = await connect()
    expect(connection.agentId).toBe(input.agentId)
  })

  it('keeps an accepted execution alive across an ownership-only reconcile rejection', async () => {
    const { connection } = await connect()
    mocks.capture.mockImplementation(async () => {
      throw new PiInvalidConnectionSnapshotError('reassigned', 'reassigned')
    })
    await expect(connection.reconcile({ modelId, servesAcceptedTurn: true })).resolves.toBe('stale-owner')
    mocks.capture.mockImplementation(async () => {
      throw new PiInvalidConnectionSnapshotError('unavailable', 'unavailable')
    })
    await expect(connection.reconcile({ modelId, servesAcceptedTurn: true })).resolves.toBe('invalid')
  })

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
    'runs PowerShell file commands with Unicode paths and preserves the configured PATH',
    async () => {
      const binDirectory = join(directory, 'test bin')
      mkdirSync(binDirectory)
      writeFileSync(join(binDirectory, 'cherry-path-probe.cmd'), '@echo off\r\necho PATH probe succeeded\r\n')
      const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'Path'
      vi.mocked(getShellEnv).mockResolvedValue({
        [pathKey]: `${binDirectory};${process.env[pathKey] ?? ''}`
      })
      setScript([
        assistantReply(
          [
            {
              type: 'toolCall',
              id: 'powershell-file',
              name: 'powershell',
              arguments: {
                command:
                  "Set-Content -LiteralPath './报告 with spaces.txt' -Value 'PowerShell 正常' -Encoding utf8; Get-Content -LiteralPath './报告 with spaces.txt'; & cherry-path-probe.cmd"
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
      expect(JSON.stringify(output)).toContain('PATH probe succeeded')
      expect(JSON.stringify(output)).toContain('PowerShell 正常')
      expect(output).toMatchObject({ state: 'output-available' })
    }
  )

  // An idle observation during summary generation must not finish the owning desktop turn.
  it.each(['complete', 'error', 'stop', 'close'] as const)(
    'keeps manual compaction owned through %s',
    async (outcome) => {
      const summary = gate()
      mocks.binding.mockImplementation(async () =>
        createTestBinding({ model: { ...MODEL, contextWindow: 1_000_000 }, stream: script.model })
      )
      script = respondingModel((call) =>
        call.systemPrompt.startsWith('Summarize the conversation')
          ? summary.wait(assistantReply('Remember the original objective', outcome === 'error' ? 'error' : 'stop'))
          : assistantReply('answer')
      )
      const { connection, events } = await connect()
      await connection.send({ message: message('Original objective') })
      await done(events)
      events.length = 0
      await connection.send({ message: message('Recent context '.repeat(8000)) })
      await done(events)
      events.length = 0
      const compacting = connection.send({ message: message('/compact') })
      try {
        await summary.reached
        expect(events.some((event) => event.type === 'compaction-start')).toBe(true)
        expect(events.filter((event) => event.type === 'turn-complete' || event.type === 'error')).toEqual([])
        await expect(connection.send({ message: message('overlapping input') })).rejects.toThrow('active submission')
        if (outcome === 'stop') await connection.interrupt()
        if (outcome === 'close') await connection.close()
      } finally {
        summary.open()
        await compacting
      }
      if (outcome === 'close') {
        expect(
          events.filter((event) => event.type === 'turn-complete' || event.type === 'compaction-complete')
        ).toEqual([])
        return
      }
      await done(events)
      if (outcome === 'error') {
        expect(events.filter((event) => event.type === 'compaction-complete')).toEqual([
          { type: 'compaction-complete' }
        ])
        expect(events.filter((event) => event.type === 'error')).toEqual([])
        return
      }
      if (outcome !== 'complete') {
        expect(
          events.filter((event) => event.type === 'compaction-complete' || event.type === 'turn-complete')
        ).toEqual([])
        expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
        return
      }
      const terminals = events.filter((event) => event.type === 'compaction-complete' || event.type === 'turn-complete')
      expect(terminals.map((event) => event.type)).toEqual(['compaction-complete', 'turn-complete'])
      expect(events.filter((event) => event.type === 'error')).toEqual([])
    }
  )

  // A no-op command must explain its result instead of persisting an empty successful reply.
  it('shows an unchanged-history reply when manual compaction has no summary to commit', async () => {
    const { connection, events } = await connect()
    await connection.send({ message: message('/compact') })
    await done(events)
    expect(text(events)).toBe('No summary was committed; the conversation is unchanged.')
    expect(events.filter((event) => event.type === 'compaction-complete')).toEqual([{ type: 'compaction-complete' }])
    expect(script.calls).toHaveLength(0)
  })

  // A freshly allocated Durable root must not resolve the verifier's initialization ID as a child.
  it('verifies and completes a goal in a newly created native root', async () => {
    script = respondingModel((call) => {
      if (call.systemPrompt.startsWith('Evaluate whether the objective'))
        return assistantReply('{"verdict":"met","reason":"Output is present"}')
      const results = call.messages.filter((entry) => entry.role === 'toolResult')
      const completed = results.find((entry) => entry.toolName === 'update_goal')
      if (completed) return assistantReply('GOAL_VERIFIED')
      const lookup = results.find((entry) => entry.toolName === 'get_goal')
      if (!lookup) return assistantReply([toolCallPart('get-goal', 'get_goal', {})], 'toolUse')
      const body = lookup.content.find((part) => part.type === 'text')!
      if (body.type !== 'text') throw new Error('Goal result has no text')
      const { goal } = JSON.parse(body.text.split('\n')[0])
      return assistantReply(
        [
          toolCallPart('complete-goal', 'update_goal', {
            goal_id: goal.id,
            revision: goal.revision,
            action: 'complete',
            evidence: 'The requested output has been produced.'
          })
        ],
        'toolUse'
      )
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('/goal Produce the requested output') })
    await expect.poll(() => text(events)).toContain('GOAL_VERIFIED')
    expect(script.calls.filter((call) => call.systemPrompt.startsWith('Evaluate whether the objective'))).toHaveLength(
      1
    )
    const completion = projected(events)
      .flatMap((message) => message.parts)
      .find((part) => part.type === 'dynamic-tool' && part.toolName === 'update_goal')
    expect(completion).toMatchObject({ state: 'output-available' })
  })

  // Locally handled commands must keep their answer when the desktop consumes message projections.
  it('shows the goal command answer without starting a model turn', async () => {
    const { connection, events } = await connect()
    await connection.send({ message: message('/goal') })
    await done(events)
    expect(text(events)).toBe('No goal is set. Use /goal <objective> to create one.')
    expect(script.calls).toHaveLength(0)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

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
    await expect.poll(() => approvals().length).toBe(1)

    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: to }
    expect(await connection.reconcile({ modelId: input.modelId })).toBe('patched')
    toolApprovalRegistry.dispatch(approvals()[0].request.approvalId, {
      approved: true,
      updatedInput: { answers: { 'Continue?': 'Yes' } }
    })

    if (asksForWrite) {
      await expect.poll(() => approvals().length).toBe(2)
      expect(approvals()[1].request).toMatchObject({ toolCallId: 'write' })
      expect(existsSync(join(directory, 'after-switch.txt'))).toBe(false)
      toolApprovalRegistry.dispatch(approvals()[1].request.approvalId, { approved: true })
    }
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(approvals()).toHaveLength(asksForWrite ? 2 : 1)
    expect(readFileSync(join(directory, 'after-switch.txt'), 'utf8')).toBe('written')
  })

  // Catches a parked approval card outliving owner shutdown while reopen must still ask again.
  it('reports a pending approval as aborted on close and asks again after reopen', async () => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'default' }
    setScript([assistantReply([toolCallPart('write', 'write', { path: 'a.txt', content: 'a' })], 'toolUse')])
    const aborted: string[] = []
    const subscription = toolApprovalRegistry.onAborted((entry) => aborted.push(entry.approvalId))
    const approvals = (events: AgentRuntimeEvent[]) =>
      events.flatMap((event) => (event.type === 'tool-approval-request' ? [event.request.approvalId] : []))
    const first = await connect()
    await first.connection.send({ message: message('write') })
    await expect.poll(() => approvals(first.events)).toHaveLength(1)

    await first.connection.close()
    subscription.dispose()
    expect(aborted).toEqual(approvals(first.events))

    const second = await connect()
    await expect.poll(() => approvals(second.events)).toEqual(approvals(first.events))
    expect(existsSync(join(directory, 'a.txt'))).toBe(false)
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
    const context = prepareDurableBranch(input.sessionId)
    expect(first.nativeInputs.some((state) => state.inputId === user.id && state.outcome === 'completed')).toBe(true)
    expect(messages.inputBinding(input.sessionId, user.id)).toMatchObject({
      contextId: context.id,
      nativeInputId: expect.any(String)
    })
    await first.connection.close()
    setScript([assistantReply('second answer')])
    const second = await connect()
    await second.connection.send({ message: message('second') })
    await done(second.events)
    expect(text(second.events)).toBe('second answer')
    expect(prepareDurableBranch(input.sessionId).nativeThreadId).toBe(context.nativeThreadId)
    expect(JSON.stringify(script.calls[0].messages)).toContain('first streaming answer')
  })

  // Catches Durable dropping provider-reported reasoning tokens from the root turn's usage metadata.
  it('reports reasoning tokens in the root turn usage metadata', async () => {
    const root: { providerSessionId?: string } = {}
    const usage: Usage = {
      input: 5,
      output: 7,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 3,
      totalTokens: 12,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
    mocks.binding.mockImplementation(async (_input, _provider, _model, onUsage) =>
      createTestBinding({
        model: MODEL,
        stream: (model, context, options) => {
          onUsage(usage, root.providerSessionId)
          return script.model(model, context, options)
        }
      })
    )
    const { connection, events, handle } = await connect()
    root.providerSessionId = await handle.durable.providerSessionId()
    await connection.send({ message: message('hello') })
    await done(events)

    const metadata = events.flatMap((event) =>
      event.type === 'chunk' && event.chunk.type === 'message-metadata' ? [event.chunk.messageMetadata] : []
    )
    expect(metadata.at(-1)).toEqual({
      totalTokens: 12,
      stats: { inputTokens: 5, outputTokens: 7, totalTokens: 12, outputTokenDetails: { reasoningTokens: 3 } }
    })
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
    const { connection, events, nativeInputs } = await connect()
    const first = message('first')
    await connection.send({ message: first })
    await expect.poll(() => text(events)).toBe('first answer')
    finish()
    const late = message('late correction')
    expect(connection.redirect({ message: late })).toBe(true)
    await expect
      .poll(() => nativeInputs.some((state) => state.inputId === late.id && state.outcome === 'completed'))
      .toBe(true)
    expect(nativeInputs.some((state) => state.inputId === first.id && state.outcome === 'completed')).toBe(true)
    expect(injected).toBe(true)
    expect(text(events)).toBe('first answernext answer')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  it('lets subagents write without approval when the root uses default permissions', async () => {
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
    await done(events)
    expect(readFileSync(join(directory, 'child-result.txt'), 'utf8')).toBe('child completed')
    expect(events.filter((event) => event.type === 'tool-approval-request')).toEqual([])
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  it.each(['reopen', 'retry archive flush'] as const)(
    'retains independent child output and continuation after %s',
    async (scenario) => {
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
            ? held.wait({ ...assistantReply('child first answer'), responseId: 'child-response-1' })
            : { ...assistantReply('child continued answer'), responseId: 'child-response-2' }
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
      expect(view!.snapshot().canSubmit).toBe(true)
      expect(text(events)).not.toContain('child first')
      held.open()
      await expect.poll(() => JSON.stringify(view!.snapshot().messages)).toContain('child first answer')
      await expect.poll(() => view!.snapshot().active).toBe(false)
      const contextId = view!.snapshot().contextId
      const childIdentity = contexts.context(contextId).nativeThreadId
      await connection.messageChild(contextId, 'continue research')
      await expect.poll(() => JSON.stringify(view!.snapshot().messages)).toContain('child continued answer')
      expect(contexts.context(contextId).nativeThreadId).toBe(childIdentity)
      const childMessage = view!
        .snapshot()
        .messages.find((message) =>
          message.parts.some((part) => part.type === 'text' && part.text === 'child continued answer')
        )!
      await expect
        .poll(() =>
          events.filter((event) => event.type === 'response-start' && event.responseId === 'child-response-2')
        )
        .toContainEqual({
          type: 'response-start',
          responseId: 'child-response-2',
          messageId: childMessage.id
        })
      expect(child).not.toBe(root)
      expect(text(events)).not.toContain('child continued answer')
      expect(events.filter((event) => event.type === 'error')).toEqual([])
      if (scenario === 'retry archive flush') {
        const shutdown = vi.spyOn(connection['runtime']!, 'shutdown')
        vi.spyOn(contexts, 'saveProjectionTx').mockImplementationOnce(() => {
          throw new Error('archive temporarily unavailable')
        })
        await expect(connection.close()).rejects.toThrow('archive temporarily unavailable')
        await connection.close()
        expect(shutdown).toHaveBeenCalledTimes(1)
        expect(view!.snapshot().available).toBe(false)
      } else {
        await connection.close()
      }
      setScript([assistantReply('child answer after reopen')])
      const reopened = await connect()
      const restored = await reopened.connection.childProjection('spawn')
      expect(restored?.snapshot().contextId).toBe(contextId)
      expect(JSON.stringify(restored?.snapshot().messages)).toContain('child continued answer')
      expect(text(reopened.events)).toBe('')
      await reopened.connection.messageChild(contextId, 'continue after reopen')
      await expect.poll(() => JSON.stringify(restored!.snapshot().messages)).toContain('child answer after reopen')
      expect(script.calls[0].model.id).toBe(MODEL.id)
    }
  )

  // Catches a continuation saved ahead of child output that the projection has received but not yet written.
  it.each(['acknowledged', 'rejected'] as const)(
    'keeps a %s continuation after child output that is still pending its archive write',
    async (outcome) => {
      const held = gate()
      let root = ''
      let childRuns = 0
      script = respondingModel((call) => {
        root ||= call.sessionId!
        if (call.sessionId !== root) {
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
      await connection.send({ message: message('delegate') })
      await held.reached
      await done(events)
      const view = (await connection.childProjection('spawn'))!
      const contextId = view.snapshot().contextId
      const [child] = await connection['childResources']()
      if (outcome === 'rejected')
        vi.spyOn(child.handle.input, 'submit').mockImplementationOnce(async (draft) => ({
          status: 'rejected',
          inputId: draft.inputId,
          error: { operation: 'submit', code: 'busy', message: 'child is busy' }
        }))
      const order = (messages: readonly { parts: readonly { type: string; text?: string }[] }[]) => {
        const texts = messages.flatMap((entry) =>
          entry.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
        )
        return { answer: texts.indexOf('child first answer'), steer: texts.indexOf('steer now') }
      }
      const inverted: unknown[] = []
      view.subscribe(() => {
        const { answer, steer } = order(view.snapshot().messages)
        if (steer >= 0 && steer < answer) inverted.push(view.snapshot().messages)
      })
      let steering: Promise<string> | undefined
      await child.handle.observe(async (event) => {
        if (!steering && event.type === 'snapshot' && JSON.stringify(event.messages).includes('child first answer'))
          steering = connection.messageChild(contextId, 'steer now').then(
            () => 'sent',
            (error: Error) => error.message
          )
      })
      held.open()
      await expect.poll(() => steering !== undefined).toBe(true)
      expect(await steering).toBe(outcome === 'rejected' ? 'child is busy' : 'sent')
      if (outcome === 'acknowledged')
        await expect.poll(() => JSON.stringify(view.snapshot().messages)).toContain('child continued answer')
      await connection.drainChildWrites()
      const saved = order(savedChildView(contexts.context(contextId)).messages)
      expect(saved.answer).toBeGreaterThanOrEqual(0)
      expect(saved.steer).toBeGreaterThan(saved.answer)
      expect(inverted).toEqual([])
    }
  )

  // Catches releasing a reply between result delivery and the parent notification generation.
  it('keeps spawn and continuation results pending through native notification revisions', async () => {
    const childGates = [gate(), gate()]
    const summaryGates = [gate(), gate()]
    let root = ''
    let childId = ''
    let children = 0
    let summaries = 0
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) return childGates[children++].wait(assistantReply('child result'))
      const last = JSON.stringify(call.messages.at(-1))
      if (last.includes('delegate'))
        return assistantReply(
          [toolCallPart('spawn', 'subagent', { description: 'scan', prompt: 'task', background: true })],
          'toolUse'
        )
      if (last.includes('continue-child'))
        return assistantReply(
          [toolCallPart('continue', 'message_subagent', { id: childId, message: 'next task' })],
          'toolUse'
        )
      if (last.includes('Background subagent update'))
        return summaryGates[summaries++].wait(assistantReply('parent summary'))
      return assistantReply('Parent waiting')
    })
    try {
      const { connection, events, handle } = await connect()
      const batches: DurableObservation[] = []
      await handle.durable.observe((batch) => {
        batches.push(batch)
      })
      const pending = () => batches.at(-1)?.backgroundResults
      for (const [index, call] of ['spawn', 'continue'].entries()) {
        await connection.send({ message: message(index === 0 ? 'delegate' : 'continue-child') })
        await childGates[index].reached
        await expect.poll(pending).toMatchObject({ status: 'confirmed', value: { pending: [call] } })
        await expect.poll(() => events.filter((event) => event.type === 'turn-complete').length).toBe(index * 2 + 1)
        const relation = batches
          .flatMap((batch) => batch.events)
          .flatMap((event) =>
            event.type === 'snapshot'
              ? (event.subagents ?? [])
              : event.type === 'subagent.upsert'
                ? [event.subagent]
                : []
          )
          .find((child) => child.child)
        if (!relation?.child) throw new Error('Missing child')
        childId = relation.child.id
        const beforeNotification = batches.length
        childGates[index].open()
        await summaryGates[index].reached
        await expect
          .poll(() => events.findLast((event) => event.type === 'autonomous-turn-state' && event.state === 'started'))
          .toMatchObject({ sourceToolCallIds: [call] })
        expect(
          batches
            .slice(beforeNotification)
            .every(
              (batch) =>
                batch.backgroundResults.status === 'confirmed' && batch.backgroundResults.value.pending.includes(call)
            )
        ).toBe(true)
        summaryGates[index].open()
        await expect.poll(pending).toMatchObject({ status: 'confirmed', value: { active: false, pending: [] } })
      }
      expect(events.filter((event) => event.type === 'error')).toEqual([])
    } finally {
      for (const held of [...childGates, ...summaryGates]) held.open()
    }
  })

  it('drains native background work and blocked child observation before final persistence', async () => {
    const answering = gate()
    const observing = gate()
    let root = ''
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) return answering.wait(assistantReply('Final child output'))
      if (!call.messages.some((entry) => entry.role === 'toolResult'))
        return assistantReply(
          [toolCallPart('spawn', 'subagent', { description: 'drain', prompt: 'work', background: true })],
          'toolUse'
        )
      return assistantReply('Parent finished')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('delegate') })
    await answering.reached
    await done(events)
    const view = (await connection.childProjection('spawn'))!
    const accept = ThreadMessageProjection.prototype.accept
    let blocked = false
    const observer = vi.spyOn(ThreadMessageProjection.prototype, 'accept').mockImplementation(async function (
      this: ThreadMessageProjection,
      ...args
    ) {
      if (!blocked && JSON.stringify(args).includes('Final child output')) {
        blocked = true
        await observing.wait(undefined)
      }
      return accept.apply(this, args)
    })
    try {
      let drained = false
      const draining = connection.drainChildWrites().then(() => {
        drained = true
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(drained).toBe(false)
      answering.open()
      await observing.reached
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(drained).toBe(false)
      observing.open()
      await draining
      expect(JSON.stringify(savedChildView(contexts.context(view.snapshot().contextId)).messages)).toContain(
        'Final child output'
      )
      const changes = dbh.sqlite.prepare('SELECT total_changes() AS count').get()
      await new Promise((resolve) => setTimeout(resolve, 160))
      expect(dbh.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(changes)
    } finally {
      answering.open()
      observing.open()
      observer.mockRestore()
    }
  })

  it('streams child text and tool progress after the parent finishes', async () => {
    let root = ''
    const releaseTool = join(directory, 'release-tool')
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root)
        return assistantReply(
          [
            toolCallPart('child-bash', 'bash', {
              command: `printf 'TOOL-FIRST'; while [ ! -f '${releaseTool}' ]; do /bin/sleep 0.05; done; printf 'TOOL-LAST'`
            })
          ],
          'toolUse'
        )
      if (!call.messages.some((entry) => entry.role === 'toolResult'))
        return assistantReply(
          [toolCallPart('spawn', 'subagent', { description: 'streaming child', prompt: 'work', background: true })],
          'toolUse'
        )
      return assistantReply('parent done')
    })
    const fallback = script.model
    let append!: () => void
    let finish!: () => void
    script.model = (model, context, options) => {
      if (
        !root ||
        options?.sessionId === root ||
        !context.messages.some((entry) => entry.role === 'toolResult' && entry.toolCallId === 'child-bash')
      )
        return fallback(model, context, options)
      const stream = createAssistantMessageEventStream()
      const partial = { ...assistantReply('child prefix'), model: model.id, api: model.api, provider: model.provider }
      stream.push({ type: 'start', partial })
      stream.push({ type: 'text_delta', contentIndex: 0, delta: 'child prefix', partial })
      append = () => {
        partial.content = [{ type: 'text', text: 'child prefix suffix' }]
        stream.push({ type: 'text_delta', contentIndex: 0, delta: ' suffix', partial })
      }
      const abort = () => {
        partial.stopReason = 'aborted'
        stream.push({ type: 'error', reason: 'aborted', error: partial })
        stream.end(partial)
      }
      options?.signal?.addEventListener('abort', abort, { once: true })
      finish = () => {
        options?.signal?.removeEventListener('abort', abort)
        stream.push({ type: 'done', reason: 'stop', message: partial })
        stream.end(partial)
      }
      return stream
    }
    const { connection, events } = await connect()
    await connection.send({ message: message('delegate') })
    await done(events)
    const view = await connection.childProjection('spawn')
    expect(view).toBeDefined()
    const tool = () =>
      view!
        .snapshot()
        .messages.flatMap((message) => message.parts)
        .find((part) => part.type === 'dynamic-tool')
    await expect.poll(() => JSON.stringify(tool()?.output)).toContain('TOOL-FIRST')
    expect(view!.snapshot().active).toBe(true)
    expect(tool()).toMatchObject({
      toolCallId: 'child-bash',
      toolName: 'bash',
      state: 'output-available',
      preliminary: true,
      callProviderMetadata: { cherry: { transport: 'pi-agent' } }
    })
    expect(JSON.stringify(tool()?.output)).not.toContain('TOOL-LAST')

    writeFileSync(releaseTool, '')
    const answer = () =>
      view!
        .snapshot()
        .messages.find((message) =>
          message.parts.some((part) => part.type === 'text' && part.text.startsWith('child prefix'))
        )
    await expect.poll(answer).toMatchObject({
      metadata: { status: 'pending' },
      parts: expect.arrayContaining([{ type: 'text', text: 'child prefix', state: 'streaming' }])
    })
    const id = answer()!.id
    append()
    await expect.poll(answer).toMatchObject({
      id,
      metadata: { status: 'pending' },
      parts: expect.arrayContaining([{ type: 'text', text: 'child prefix suffix', state: 'streaming' }])
    })
    expect(view!.snapshot().active).toBe(true)
    expect(JSON.stringify(tool()?.output)).toContain('TOOL-LAST')
    expect(tool()).toMatchObject({ preliminary: false })
    finish()
    await expect.poll(() => view!.snapshot().active).toBe(false)
    expect(answer()).toMatchObject({ id, metadata: { status: 'success' } })
    expect(text(events)).not.toContain('child prefix')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
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
      expect(first.nativeInputs.some((state) => state.inputId === user.id && state.outcome === 'aborted')).toBe(true)
    }
  })

  it('persists cancellation during a native tool and does not continue after reopen', async () => {
    const tool = process.platform === 'win32' ? 'powershell' : 'bash'
    const command =
      tool === 'powershell'
        ? 'Set-Content -LiteralPath started.txt -Value ready; Start-Sleep -Seconds 30; Set-Content -LiteralPath completed.txt -Value late'
        : 'echo ready > started.txt; /bin/sleep 30; echo late > completed.txt'
    setScript([assistantReply([toolCallPart(tool, tool, { command })], 'toolUse'), assistantReply('must not run')])
    const { connection, events, nativeInputs } = await connect()
    const user = message('run a tool')
    await connection.send({ message: user })
    await expect.poll(() => existsSync(join(directory, 'started.txt')), { timeout: 10_000 }).toBe(true)
    await connection.interrupt()
    await connection.close()
    expect(nativeInputs.some((state) => state.inputId === user.id && state.outcome === 'aborted')).toBe(true)
    expect(existsSync(join(directory, 'completed.txt'))).toBe(false)
    expect(text(events)).not.toContain('must not run')
    setScript([assistantReply('must not resume')])
    const reopened = await connect()
    await reopened.connection.close()
    expect(script.calls).toHaveLength(0)
  })

  it.each([true, false])('waits for native-only pending work with a retained message: %s', async (retained) => {
    const { connection, events, handle } = await connect()
    const context = prepareDurableBranch(input.sessionId)
    const nativeInput = { session: handle.thread, id: runtimeId<'native-input'>('queued-input') }
    if (retained) {
      const user = message('queued before restart')
      prepareNativeSubmission(input.sessionId, user.id, context.id, 'follow-up')
      bindNativeInput(input.sessionId, context.id, {
        inputId: runtimeId(user.id),
        nativeInput,
        facts: ['accepted', 'queued']
      })
    }
    const queued: InputState = { nativeInput, facts: ['accepted', 'queued'] }
    const observer = connection as unknown as {
      onObservation(batch: DurableObservation): Promise<void>
    }
    const snapshot = { type: 'snapshot' as const, messages: [], inputs: [queued] }
    await observer.onObservation({
      backgroundResults: { status: 'confirmed', value: { active: false, pending: [], notification: [] } },
      events: [{ ...snapshot, activity: { state: 'active' } }],
      aliases: {},
      live: []
    })
    await observer.onObservation({
      backgroundResults: { status: 'confirmed', value: { active: false, pending: [], notification: [] } },
      events: [{ ...snapshot, activity: { state: 'idle' } }],
      aliases: {},
      live: []
    })
    expect(events.some((event) => event.type === 'autonomous-turn-state' && event.state === 'started')).toBe(true)
    expect(events.filter((event) => event.type === 'turn-complete' || event.type === 'error')).toEqual([])
    const completed = { ...queued, outcome: 'completed' as const }
    await observer.onObservation({
      backgroundResults: { status: 'confirmed', value: { active: false, pending: [], notification: [] } },
      events: [{ ...snapshot, inputs: [completed], activity: { state: 'idle' } }],
      aliases: {},
      live: [],
      completion: { inputs: [completed] }
    })
    await done(events)
    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(script.calls).toHaveLength(0)
  })

  it.each(['rejected', 'unsupported', 'unknown'] as const)(
    'preserves only uncertain input bindings after %s',
    async (status) => {
      const { connection, handle } = await connect()
      const user = message('not accepted')
      vi.spyOn(handle.input, 'submit').mockResolvedValue({
        status,
        inputId: runtimeId(user.id),
        error: { operation: 'submit', code: 'fixture', message: status }
      })
      await expect(connection.send({ message: user })).rejects.toThrow(status)
      if (status === 'unknown') {
        expect(messages.inputBinding(input.sessionId, user.id)?.contextId).toBe(
          prepareDurableBranch(input.sessionId).id
        )
        expect(() => messages.deleteSessionMessage(input.sessionId, user.id)).toThrow('native input binding')
      } else {
        expect(messages.inputBinding(input.sessionId, user.id)).toBeUndefined()
        messages.updateSessionMessage(input.sessionId, user.id, {
          data: { parts: [{ type: 'text', text: 'corrected' }] }
        })
        messages.deleteSessionMessage(input.sessionId, user.id)
        expect(() => messages.getSessionMessage(input.sessionId, user.id)).toThrow()
      }
      expect(script.calls).toHaveLength(0)
    }
  )
})
