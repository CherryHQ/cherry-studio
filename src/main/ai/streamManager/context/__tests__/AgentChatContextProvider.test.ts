import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { AiRuntimeCapability, toAgentRuntimeSegmentId } from '@main/ai/runtime/types'
import { AgentSessionDeliveryReplyPolicy, AgentSessionDeliveryStatus } from '@shared/ai/agentSessionDelivery'
import { ConversationKind, ConversationOpenTrigger, ConversationOutcomeKind } from '@shared/ai/conversation'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentConversationRuntimeTurnKind } from '../../../agentSession/AgentConnectionManager'
import { runtimeDriverRegistry } from '../../../runtime/registry'
import {
  ConversationHistoryAdapterKind,
  type ConversationIntentValidationContext,
  ConversationPostCommitTaskKind
} from '../ConversationHistoryPort'
import type { MainDispatchRequest } from '../dispatch'
import { assertPureCommittedIntent } from './assertPureCommittedIntent'

const driver = vi.hoisted(() => ({
  validateSession: vi.fn(async () => {})
}))

const manager = vi.hoisted(() => ({
  activateConversationRuntimeTurn: vi.fn(async () => {}),
  createExecutionReleaseListener: vi.fn(() => ({
    id: 'agent-release',
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  })),
  prepareTurnResources: vi.fn(),
  rejectConversationRuntimeTurn: vi.fn(),
  releaseExecutionResource: vi.fn(),
  runtimeResumeToken: vi.fn(() => undefined)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  const get = module.application.get
  module.application.get = vi.fn((name: string) =>
    name === 'AgentConnectionManager' ? manager : get(name)
  ) as typeof module.application.get
  return module
})

const { AgentChatContextProvider } = await import('../AgentChatContextProvider')

const SESSION_ID = 'session-1'
const AGENT_ID = 'agent-1'
const ASSISTANT_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'
const MODEL_ID = createUniqueModelId('provider', 'model')
const UPDATED_MODEL_ID = createUniqueModelId('provider', 'updated-model')

function request(overrides: Partial<MainDispatchRequest> = {}): MainDispatchRequest {
  return {
    trigger: ConversationOpenTrigger.SubmitMessage,
    conversation: { kind: ConversationKind.Agent, id: SESSION_ID },
    userMessageParts: [{ type: 'text', text: 'hello' }],
    ...overrides
  } as MainDispatchRequest
}

async function validateAndCommit(
  provider: InstanceType<typeof AgentChatContextProvider>,
  req: MainDispatchRequest = request(),
  context: ConversationIntentValidationContext = { hasLiveStream: false }
) {
  const validation = await provider.validateIntent(req, context, new AbortController().signal)
  return { validation, committed: provider.commitIntent(validation, context) }
}

async function prepareCommitted(
  provider: InstanceType<typeof AgentChatContextProvider>,
  committed: ReturnType<InstanceType<typeof AgentChatContextProvider>['commitIntent']>
) {
  return provider.prepareExecutionContext(committed.executions[0].preparation, new AbortController().signal)
}

async function prepareQueuedSuccessor(
  provider: InstanceType<typeof AgentChatContextProvider>,
  overrides: Partial<MainDispatchRequest> = {}
) {
  const queuedRequest = request(overrides)
  const committedValidation = await provider.validateIntent(
    queuedRequest,
    { hasLiveStream: true },
    new AbortController().signal
  )
  provider.commitIntent(committedValidation, { hasLiveStream: true })
  if (committedValidation.kind !== ConversationHistoryAdapterKind.Agent) throw new Error('Agent input changed adapter')
  const userMessage = agentSessionMessageService.getSessionMessage(SESSION_ID, committedValidation.agent.userMessageId)
  const revalidated = await provider.revalidateCommittedInput(
    request({ ...overrides, agentDeliveryMessage: userMessage }),
    committedValidation,
    { hasLiveStream: false },
    new AbortController().signal
  )
  const committed = provider.commitIntent(revalidated, { hasLiveStream: false })
  return {
    committed,
    context: await provider.prepareExecutionContext(committed.executions[0].preparation, new AbortController().signal)
  }
}

describe('AgentChatContextProvider', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    vi.clearAllMocks()
    runtimeDriverRegistry.clearForTest()
    runtimeDriverRegistry.register({
      type: 'claude-code',
      capabilities: [AiRuntimeCapability.AgentSession],
      connect: vi.fn(),
      validateSession: driver.validateSession,
      listAvailableTools: vi.fn(async () => [])
    })
    await dbh.db.insert(agentWorkspaceTable).values({
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace-1',
      type: 'user',
      orderKey: 'workspace-1'
    })
    await dbh.db.insert(userProviderTable).values({
      providerId: 'provider',
      name: 'Provider',
      orderKey: 'provider-1'
    })
    await dbh.db.insert(userModelTable).values({
      id: MODEL_ID,
      providerId: 'provider',
      modelId: 'model',
      presetModelId: 'model',
      name: 'Model',
      orderKey: 'model-1'
    })
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'My Agent',
      instructions: 'Help the user',
      model: MODEL_ID,
      orderKey: 'agent-1'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: SESSION_ID,
      agentId: AGENT_ID,
      workspaceId: 'workspace-1',
      name: '',
      orderKey: 'session-1',
      lastActivityAt: 0
    })
  })

  it('treats runtime turns as persistent conversations without caller metadata', async () => {
    const provider = new AgentChatContextProvider()
    const validation = await provider.validateIntent(request(), { hasLiveStream: false }, new AbortController().signal)

    expect(driver.validateSession).toHaveBeenCalledOnce()
    expect(provider.isPersistentConversation).toBe(true)
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, SESSION_ID)).all()
    ).toEqual([])

    const committed = provider.commitIntent(validation, { hasLiveStream: false })
    assertPureCommittedIntent(committed)
    const saved = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, SESSION_ID))
      .orderBy(asc(agentSessionMessageTable.createdAt), asc(agentSessionMessageTable.id))
      .all()

    expect(saved.map(({ role, status, modelId }) => ({ role, status, modelId }))).toEqual([
      { role: 'user', status: 'success', modelId: null },
      { role: 'assistant', status: 'pending', modelId: MODEL_ID }
    ])
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()

    const execution = committed.executions[0]
    const context = await provider.prepareExecutionContext(execution.preparation, new AbortController().signal)
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
    expect(execution.preparation).toMatchObject({
      conversation: { kind: ConversationKind.Agent, id: SESSION_ID },
      agentId: AGENT_ID,
      modelId: MODEL_ID,
      outputNodeId: saved.find(({ role }) => role === 'assistant')?.id,
      userMessage: expect.objectContaining({ id: saved.find(({ role }) => role === 'user')?.id }),
      headless: false,
      shouldAutoName: true
    })
    expect(context.models).toEqual([
      expect.objectContaining({
        modelId: MODEL_ID,
        request: expect.objectContaining({
          messageId: saved.find(({ role }) => role === 'assistant')?.id,
          runtime: expect.objectContaining({ kind: 'agent-session', sessionId: SESSION_ID })
        })
      })
    ])
  })

  it('commits a same-profile inbox batch as two user rows and one runtime execution', async () => {
    const provider = new AgentChatContextProvider()
    const context = { hasLiveStream: false }
    const validations = await Promise.all(
      ['follow-up B', 'follow-up C'].map((text) =>
        provider.validateIntent(
          request({ userMessageParts: [{ type: 'text', text }] }),
          context,
          new AbortController().signal
        )
      )
    )

    const committed = provider.commitBatchIntent(validations, context)

    expect(committed.reservedMessages.map(({ role }) => role)).toEqual(['user', 'user', 'assistant'])
    expect(committed.executions).toHaveLength(1)
    const preparation = committed.executions[0]?.preparation
    expect(preparation?.kind).toBe('agent-fresh')
    if (preparation?.kind !== 'agent-fresh') throw new Error('Expected Agent fresh preparation')
    expect(preparation.userMessage.data.parts?.flatMap((part) => (part.type === 'text' ? [part.text] : []))).toEqual([
      'follow-up B',
      'follow-up C'
    ])
    expect(
      dbh.db
        .select({ role: agentSessionMessageTable.role })
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.sessionId, SESSION_ID))
        .all()
        .map(({ role }) => role)
    ).toEqual(['user', 'user', 'assistant'])
  })

  it('prepares live inject without creating a new runtime turn or assistant placeholder', async () => {
    const provider = new AgentChatContextProvider()
    const { validation, committed } = await validateAndCommit(provider, request(), { hasLiveStream: true })

    expect(validation.executionModelIds).toEqual([])
    expect(committed.executions).toEqual([])
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
    expect(
      dbh.db
        .select({ role: agentSessionMessageTable.role, status: agentSessionMessageTable.status })
        .from(agentSessionMessageTable)
        .all()
    ).toEqual([{ role: 'user', status: 'success' }])
  })

  it('does not drain a queued turn onto a stale deleted model; surfaces an error and settles', async () => {
    const provider = new AgentChatContextProvider()
    const validation = await provider.validateIntent(request(), { hasLiveStream: true }, new AbortController().signal)
    provider.commitIntent(validation, { hasLiveStream: true })
    const userMessageId = dbh.db
      .select({ id: agentSessionMessageTable.id })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.role, 'user'))
      .get()?.id
    if (!userMessageId) throw new Error('busy admission did not persist its user row')
    const userMessage = agentSessionMessageService.getSessionMessage(SESSION_ID, userMessageId)

    dbh.db.update(agentTable).set({ model: null }).where(eq(agentTable.id, AGENT_ID)).run()
    const serialized = { name: 'Error', message: 'Agent has no model configured', stack: null }
    const failure = provider.validateInputFailure(
      request({ agentDeliveryMessage: userMessage }),
      serialized,
      validation
    )
    if (!failure) throw new Error('queued Agent failure did not validate its terminal fallback')
    const terminal = provider.commitInputFailureIntent(failure)

    expect(terminal.executions).toEqual([
      expect.objectContaining({ modelId: MODEL_ID, outputNodeId: expect.any(String) })
    ])
    const terminalExecution = terminal.executions[0]
    await expect(
      provider.prepareExecutionContext(terminalExecution.preparation, new AbortController().signal)
    ).rejects.toThrow('Agent has no model configured')
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()

    const assistantMessageId = terminalExecution.outputNodeId
    await provider.persistTerminal(terminalExecution.persistence, {
      status: ConversationOutcomeKind.Error,
      error: serialized,
      modelId: MODEL_ID,
      anchorMessageId: assistantMessageId
    })
    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, assistantMessageId)).toMatchObject({
      status: 'error',
      modelId: MODEL_ID
    })
  })

  it('stamps a queued follow-up with its enqueue-time snapshot, not the prior turn snapshot', async () => {
    const provider = new AgentChatContextProvider()
    const queuedRequest = request({ reasoningEffort: 'low', fastMode: true, headless: true })
    const committedValidation = await provider.validateIntent(
      queuedRequest,
      { hasLiveStream: true },
      new AbortController().signal
    )
    provider.commitIntent(committedValidation, { hasLiveStream: true })
    const userMessageId = dbh.db
      .select({ id: agentSessionMessageTable.id })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.role, 'user'))
      .get()?.id
    if (!userMessageId) throw new Error('queued input did not persist its user row')
    const userMessage = agentSessionMessageService.getSessionMessage(SESSION_ID, userMessageId)

    dbh.db
      .update(agentTable)
      .set({ name: 'Renamed Agent', configuration: { reasoning_effort: 'high' } })
      .where(eq(agentTable.id, AGENT_ID))
      .run()
    const revalidated = await provider.revalidateCommittedInput(
      request({ agentDeliveryMessage: userMessage }),
      committedValidation,
      { hasLiveStream: false },
      new AbortController().signal
    )
    if (revalidated.kind !== ConversationHistoryAdapterKind.Agent) throw new Error('Agent input changed adapter')

    expect(revalidated.agent).toMatchObject({
      agentName: 'My Agent',
      reasoningEffort: 'low',
      fastMode: true,
      headless: true,
      messageSnapshot: { name: 'My Agent', model: { id: 'model', provider: 'provider' } }
    })
    provider.commitIntent(revalidated, { hasLiveStream: false })
    const assistant = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.role, 'assistant'))
      .get()
    expect(assistant?.messageSnapshot).toMatchObject({
      name: 'My Agent',
      model: { id: 'model', provider: 'provider' }
    })
  })

  it('reconciles a queued follow-up snapshot to the model that runs after a mid-queue model edit', async () => {
    const provider = new AgentChatContextProvider()
    const queuedRequest = request({ reasoningEffort: 'low' })
    const committedValidation = await provider.validateIntent(
      queuedRequest,
      { hasLiveStream: true },
      new AbortController().signal
    )
    provider.commitIntent(committedValidation, { hasLiveStream: true })
    const userMessageId = dbh.db
      .select({ id: agentSessionMessageTable.id })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.role, 'user'))
      .get()?.id
    if (!userMessageId) throw new Error('queued input did not persist its user row')
    const userMessage = agentSessionMessageService.getSessionMessage(SESSION_ID, userMessageId)

    dbh.db
      .insert(userModelTable)
      .values({
        id: UPDATED_MODEL_ID,
        providerId: 'provider',
        modelId: 'updated-model',
        presetModelId: 'updated-model',
        name: 'Updated Model',
        orderKey: 'model-2'
      })
      .run()
    dbh.db
      .update(agentTable)
      .set({ name: 'Renamed Agent', model: UPDATED_MODEL_ID })
      .where(eq(agentTable.id, AGENT_ID))
      .run()
    const revalidated = await provider.revalidateCommittedInput(
      request({ agentDeliveryMessage: userMessage }),
      committedValidation,
      { hasLiveStream: false },
      new AbortController().signal
    )
    if (revalidated.kind !== ConversationHistoryAdapterKind.Agent) throw new Error('Agent input changed adapter')

    expect(revalidated.agent).toMatchObject({
      uniqueModelId: UPDATED_MODEL_ID,
      agentName: 'My Agent',
      reasoningEffort: 'low',
      messageSnapshot: {
        name: 'My Agent',
        model: { id: 'updated-model', name: 'Updated Model', provider: 'provider' }
      }
    })
    const committed = provider.commitIntent(revalidated, { hasLiveStream: false })
    expect(committed.executions).toEqual([
      expect.objectContaining({ modelId: UPDATED_MODEL_ID, outputNodeId: expect.any(String) })
    ])
    await prepareCommitted(provider, committed)
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
    expect(committed.executions[0]?.preparation).toMatchObject({
      modelId: UPDATED_MODEL_ID,
      messageSnapshot: revalidated.agent.messageSnapshot
    })
  })

  it('starts queued turns with the latest agent model after a model edit', async () => {
    const provider = new AgentChatContextProvider()
    const committedValidation = await provider.validateIntent(
      request(),
      { hasLiveStream: true },
      new AbortController().signal
    )
    provider.commitIntent(committedValidation, { hasLiveStream: true })
    if (committedValidation.kind !== ConversationHistoryAdapterKind.Agent)
      throw new Error('Agent input changed adapter')
    const userMessage = agentSessionMessageService.getSessionMessage(
      SESSION_ID,
      committedValidation.agent.userMessageId
    )
    dbh.db
      .insert(userModelTable)
      .values({
        id: UPDATED_MODEL_ID,
        providerId: 'provider',
        modelId: 'updated-model',
        presetModelId: 'updated-model',
        name: 'Updated Model',
        orderKey: 'model-2'
      })
      .run()
    dbh.db.update(agentTable).set({ model: UPDATED_MODEL_ID }).where(eq(agentTable.id, AGENT_ID)).run()

    const revalidated = await provider.revalidateCommittedInput(
      request({ agentDeliveryMessage: userMessage }),
      committedValidation,
      { hasLiveStream: false },
      new AbortController().signal
    )
    const committed = provider.commitIntent(revalidated, { hasLiveStream: false })
    const context = await prepareCommitted(provider, committed)

    expect(committed.executions[0]?.modelId).toBe(UPDATED_MODEL_ID)
    expect(context.models[0]?.modelId).toBe(UPDATED_MODEL_ID)
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
  })

  it('persists an active turn with the model captured when that turn began', async () => {
    const provider = new AgentChatContextProvider()
    const { committed } = await validateAndCommit(provider)
    const assistantMessageId = committed.executions[0]?.outputNodeId
    if (!assistantMessageId) throw new Error('Agent turn did not reserve its assistant row')
    dbh.db
      .insert(userModelTable)
      .values({
        id: UPDATED_MODEL_ID,
        providerId: 'provider',
        modelId: 'updated-model',
        presetModelId: 'updated-model',
        name: 'Updated Model',
        orderKey: 'model-2'
      })
      .run()
    dbh.db.update(agentTable).set({ model: UPDATED_MODEL_ID }).where(eq(agentTable.id, AGENT_ID)).run()

    await provider.persistTerminal(committed.executions[0].persistence, {
      status: ConversationOutcomeKind.Success,
      modelId: MODEL_ID,
      anchorMessageId: assistantMessageId,
      runtimeCheckpoint: { runtimeResumeToken: 'resume-exact' },
      finalMessage: { id: assistantMessageId, role: 'assistant', parts: [] }
    })

    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, assistantMessageId)).toMatchObject({
      status: 'success',
      modelId: MODEL_ID,
      runtimeResumeToken: 'resume-exact'
    })
  })

  it('prefers an explicit request reasoning effort over the persisted agent default', async () => {
    dbh.db
      .update(agentTable)
      .set({ configuration: { reasoning_effort: 'high' } })
      .where(eq(agentTable.id, AGENT_ID))
      .run()
    const provider = new AgentChatContextProvider()
    const { committed } = await validateAndCommit(provider, request({ reasoningEffort: 'low' }))

    const context = await prepareCommitted(provider, committed)
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
    expect(committed.executions[0]?.preparation).toMatchObject({ reasoningEffort: 'low' })
    expect(context.models[0]?.request.reasoningEffort).toBe('low')
  })

  it('uses the persisted agent reasoning effort when the request does not override it', async () => {
    dbh.db
      .update(agentTable)
      .set({ configuration: { reasoning_effort: 'high' } })
      .where(eq(agentTable.id, AGENT_ID))
      .run()
    const provider = new AgentChatContextProvider()
    const { committed } = await validateAndCommit(provider)

    const context = await prepareCommitted(provider, committed)
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
    expect(committed.executions[0]?.preparation).toMatchObject({ reasoningEffort: 'high' })
    expect(context.models[0]?.request.reasoningEffort).toBe('high')
  })

  it('forwards headless to the runtime when busy dispatch enqueues a follow-up', async () => {
    const provider = new AgentChatContextProvider()
    const validation = await provider.validateIntent(
      request({ headless: true }),
      { hasLiveStream: true },
      new AbortController().signal
    )

    expect(validation).toMatchObject({
      kind: ConversationHistoryAdapterKind.Agent,
      request: { headless: true },
      agent: { headless: true }
    })
  })

  it('opens a queued busy follow-up as headless when enqueueUserMessage is marked headless', async () => {
    const provider = new AgentChatContextProvider()

    const { committed, context } = await prepareQueuedSuccessor(provider, { headless: true })

    expect(committed.executions[0]?.preparation).toMatchObject({ headless: true })
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
    expect(context.models[0]?.request.runtime).toMatchObject({ kind: 'agent-session', sessionId: SESSION_ID })
  })

  it('opens an unmarked queued busy follow-up as interactive', async () => {
    const provider = new AgentChatContextProvider()

    const { committed } = await prepareQueuedSuccessor(provider)

    expect(committed.executions[0]?.preparation).toMatchObject({ headless: false })
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
  })

  it('starts queued turns with runtime request metadata and assistant seed', async () => {
    const provider = new AgentChatContextProvider()

    const { committed, context } = await prepareQueuedSuccessor(provider, {
      reasoningEffort: 'high',
      fastMode: true
    })

    const model = context.models[0]
    const assistantId = committed.executions[0]?.outputNodeId
    expect(model).toMatchObject({
      modelId: MODEL_ID,
      request: {
        chatId: SESSION_ID,
        messageId: assistantId,
        reasoningEffort: 'high',
        fastMode: true,
        runtime: { kind: 'agent-session', sessionId: SESSION_ID, turnId: expect.any(String) }
      }
    })
    expect(model?.request.messages).toEqual([
      expect.objectContaining({ role: 'user' }),
      { id: assistantId, role: 'assistant', parts: [] }
    ])
  })

  it('preserves typed workspace validation errors for the dispatch boundary', async () => {
    const workspaceError = Object.assign(new Error('workspace is unavailable'), {
      name: 'AgentSessionWorkspaceError',
      retryable: true
    })
    driver.validateSession.mockRejectedValueOnce(workspaceError)

    await expect(
      new AgentChatContextProvider().validateIntent(request(), { hasLiveStream: false }, new AbortController().signal)
    ).rejects.toBe(workspaceError)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
  })

  it('rejects agent sessions without a registered runtime driver', async () => {
    runtimeDriverRegistry.clearForTest()

    await expect(
      new AgentChatContextProvider().validateIntent(request(), { hasLiveStream: false }, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' })
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
  })

  it('rejects a late busy transition when the caller requires an idle session', async () => {
    const provider = new AgentChatContextProvider()
    const validation = await provider.validateIntent(
      request(),
      { hasLiveStream: false, requireIdle: true },
      new AbortController().signal
    )

    expect(() => provider.commitIntent(validation, { hasLiveStream: true, requireIdle: true })).toThrow(
      expect.objectContaining({ code: 'RESOURCE_LOCKED' })
    )
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
  })

  it('describes first-user-message session rename after submit-message persists the user row', async () => {
    const provider = new AgentChatContextProvider()
    const { committed } = await validateAndCommit(
      provider,
      request({ userMessageParts: [{ type: 'text', text: 'hello session' }] })
    )

    expect(dbh.db.select({ name: agentSessionTable.name }).from(agentSessionTable).get()?.name).toBe('')
    expect(committed.postCommitTasks).toContainEqual({
      kind: ConversationPostCommitTaskKind.RenameAgentFromFirstUser,
      sessionId: SESSION_ID,
      userMessageData: { parts: [{ type: 'text', text: 'hello session' }] }
    })
  })

  it('does not auto-name a busy follow-up turn', async () => {
    const provider = new AgentChatContextProvider()
    await validateAndCommit(provider, request({ userMessageParts: [{ type: 'text', text: 'busy hello' }] }), {
      hasLiveStream: true
    })

    expect(dbh.db.select({ name: agentSessionTable.name }).from(agentSessionTable).get()?.name).toBe('')
  })

  it('does not auto-name non-initial assistant turns', async () => {
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d010',
        sessionId: SESSION_ID,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'earlier' }] }
      })
      .run()

    const provider = new AgentChatContextProvider()
    const { committed } = await validateAndCommit(provider)
    await prepareCommitted(provider, committed)

    expect(dbh.db.select({ name: agentSessionTable.name }).from(agentSessionTable).get()?.name).toBe('')
    expect(manager.prepareTurnResources).not.toHaveBeenCalled()
    expect(committed.executions[0]?.preparation).toMatchObject({ shouldAutoName: false })
  })

  it('ignores a new Session delivery row when deciding whether to auto-name its first turn', async () => {
    const deliveryId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011'
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: deliveryId,
        sessionId: SESSION_ID,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'delegated work' }] },
        deliveryStatus: AgentSessionDeliveryStatus.Accepted,
        delivery: {
          version: 1,
          sender: { agentId: 'sender-agent', sessionId: 'sender-session' },
          receiver: { agentId: AGENT_ID, sessionId: SESSION_ID },
          replyPolicy: AgentSessionDeliveryReplyPolicy.None,
          sourceMessageId: null,
          outcome: null,
          error: null,
          statusAt: '2026-01-01T00:00:00.000Z'
        }
      })
      .run()
    const deliveryMessage = agentSessionMessageService.getSessionMessage(SESSION_ID, deliveryId)

    const provider = new AgentChatContextProvider()
    const { committed } = await validateAndCommit(provider, request({ agentDeliveryMessage: deliveryMessage }))

    expect(dbh.db.select({ name: agentSessionTable.name }).from(agentSessionTable).get()?.name).toBe('')
    expect(committed.postCommitTasks).toContainEqual({
      kind: ConversationPostCommitTaskKind.RenameAgentFromFirstUser,
      sessionId: SESSION_ID,
      userMessageData: { parts: [{ type: 'text', text: 'delegated work' }] }
    })
    expect(committed.reservedMessages).toEqual([
      expect.objectContaining({ id: deliveryId, role: 'user' }),
      expect.objectContaining({ role: 'assistant' })
    ])
    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, deliveryId).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Delivering
    )
  })

  it('commits the assistant skeleton and returns a descriptor before the resource executor activates it', async () => {
    const provider = new AgentChatContextProvider()
    const committed = provider.commitRuntimeIntent({
      kind: AgentConversationRuntimeTurnKind.Autonomous,
      conversation: { kind: ConversationKind.Agent, id: SESSION_ID },
      agentId: AGENT_ID,
      modelId: MODEL_ID,
      reasoningEffort: 'default',
      serviceTier: 'standard',
      fastMode: false,
      knowledgeBaseIds: [],
      headless: true,
      userMessage: {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
        sessionId: SESSION_ID,
        role: 'user',
        status: 'success',
        data: { parts: [] },
        searchableText: '',
        modelId: null,
        messageSnapshot: null,
        stats: null,
        runtimeResumeToken: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      assistantMessageId: ASSISTANT_ID,
      runtimeTurnId: 'runtime-turn-1',
      segmentId: toAgentRuntimeSegmentId('segment-autonomous')
    })

    expect(
      dbh.db
        .select({ id: agentSessionMessageTable.id, status: agentSessionMessageTable.status })
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.id, ASSISTANT_ID))
        .get()
    ).toEqual({ id: ASSISTANT_ID, status: 'pending' })
    expect(manager.activateConversationRuntimeTurn).not.toHaveBeenCalled()

    const execution = committed.executions[0]
    const context = await provider.prepareExecutionContext(execution.preparation, new AbortController().signal)

    expect(manager.activateConversationRuntimeTurn).not.toHaveBeenCalled()
    expect(execution.preparation).toMatchObject({ runtimeTurnId: 'runtime-turn-1', outputNodeId: ASSISTANT_ID })
    expect(context.models[0]?.request.messageId).toBe(ASSISTANT_ID)
    expect(execution.outputNodeId).toBe(ASSISTANT_ID)
  })

  it('abandons the roll and surfaces the error when the continuation placeholder save rejects (S5)', () => {
    const intent = {
      kind: AgentConversationRuntimeTurnKind.NativeContinuation,
      conversation: { kind: ConversationKind.Agent, id: SESSION_ID } as const,
      agentId: AGENT_ID,
      modelId: MODEL_ID,
      reasoningEffort: 'default' as const,
      serviceTier: 'standard' as const,
      fastMode: false,
      knowledgeBaseIds: [],
      headless: false,
      userMessage: {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
        sessionId: SESSION_ID,
        role: 'user' as const,
        status: 'success' as const,
        data: { parts: [{ type: 'text' as const, text: 'steer' }] },
        searchableText: 'steer',
        modelId: null,
        messageSnapshot: null,
        stats: null,
        runtimeResumeToken: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      assistantMessageId: ASSISTANT_ID,
      runtimeTurnId: 'runtime-turn-2',
      segmentId: toAgentRuntimeSegmentId('segment-continuation'),
      sourceTurnId: 'runtime-turn-1'
    }
    const saveError = new Error('assistant skeleton transaction failed')
    vi.spyOn(agentSessionMessageService, 'saveMessage').mockImplementationOnce(() => {
      throw saveError
    })
    const provider = new AgentChatContextProvider()

    expect(() => provider.commitRuntimeIntent(intent)).toThrow(saveError)

    expect(manager.rejectConversationRuntimeTurn).not.toHaveBeenCalled()
    expect(
      dbh.db
        .select({ id: agentSessionMessageTable.id })
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.id, ASSISTANT_ID))
        .get()
    ).toBeUndefined()
  })
})
