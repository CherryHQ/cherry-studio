import { randomUUID } from 'node:crypto'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { messageTable } from '@data/db/schemas/message'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicService } from '@data/services/TopicService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  validateDispatch: vi.fn(),
  activateDispatch: vi.fn(),
  send: vi.fn(),
  hasLiveStream: vi.fn(),
  isWriteQuiesced: false,
  lockTail: Promise.resolve(),
  isSessionBusy: vi.fn(),
  closeSession: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('../../streamManager/context/AgentChatContextProvider', () => ({
  agentChatContextProvider: {
    validateDispatch: mocks.validateDispatch,
    activateDispatch: mocks.activateDispatch
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const services = {
    ...defaultServiceInstances,
    AiStreamManager: {
      withDispatchLock: (_topicId: string, fn: () => Promise<unknown>) => {
        const prior = mocks.lockTail
        let release!: () => void
        mocks.lockTail = new Promise<void>((resolve) => (release = resolve))
        return prior.then(fn).finally(release)
      },
      hasLiveStream: mocks.hasLiveStream,
      get isWriteQuiesced() {
        return mocks.isWriteQuiesced
      },
      send: mocks.send
    },
    AgentSessionRuntimeService: {
      isSessionBusy: mocks.isSessionBusy,
      closeSession: mocks.closeSession
    }
  }
  return mockApplicationFactory(services as never)
})

const { startHandoff } = await import('../handoff')

const listener = {
  id: 'handoff-test-window',
  onChunk() {},
  onDone() {},
  onPaused() {},
  onError() {},
  isAlive: () => true
}

describe('startHandoff', () => {
  const dbh = setupTestDatabase()
  let sequence = 0
  let currentAgent: Record<string, unknown>
  let sourceTopicId = ''

  beforeEach(() => {
    sequence += 1
    mocks.isWriteQuiesced = false
    mocks.lockTail = Promise.resolve()
    currentAgent = {
      id: `handoff-target-${sequence}`,
      type: 'claude-code',
      name: 'Target Builder',
      description: 'Builds the requested change',
      model: 'target-provider::target-model',
      modelName: 'Target Model',
      updatedAt: '2026-09-07T00:00:00.000Z',
      configuration: {}
    }
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: `handoff-provider-${sequence}`,
        presetProviderId: 'openai',
        name: 'Handoff Target Provider',
        orderKey: `handoff-provider-${sequence}`,
        isEnabled: true
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: currentAgent.model as string,
        providerId: `handoff-provider-${sequence}`,
        modelId: 'target-model',
        name: 'Target Model',
        capabilities: [],
        supportsStreaming: true,
        contextWindow: 100_000,
        orderKey: `handoff-model-${sequence}`
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: currentAgent.id as string,
        type: currentAgent.type as string,
        name: currentAgent.name as string,
        instructions: '',
        orderKey: currentAgent.id as string,
        model: currentAgent.model as string
      })
      .run()
    sourceTopicId = topicService.create({ name: `Handoff source ${sequence}` }).id
    mocks.getAgent.mockReset().mockImplementation(() => currentAgent)
    mocks.validateDispatch.mockReset().mockImplementation((request: { topicId: string }) => {
      const sessionId = request.topicId.replace('agent-session:', '')
      return Promise.resolve({
        sessionId,
        topicId: request.topicId,
        agentId: currentAgent.id,
        agentUpdatedAt: currentAgent.updatedAt,
        agentType: currentAgent.type,
        agentName: currentAgent.name,
        uniqueModelId: currentAgent.model,
        reasoningEffort: 'default',
        serviceTier: 'standard',
        headless: false,
        messageSnapshot: {
          id: currentAgent.id,
          name: currentAgent.name,
          emoji: '🤖',
          model: { id: 'target-model', name: 'Target Model', provider: 'target-provider' }
        },
        userMessageId: 'ignored',
        userMessageParts: [],
        shouldAutoNameInitialTurn: false
      })
    })
    mocks.activateDispatch.mockImplementation(
      (persisted: { assistantMessageId: string; validated: unknown }, sub: unknown) => ({
        topicId: `agent-session:${(persisted.validated as { sessionId: string }).sessionId}`,
        models: [{ modelId: currentAgent.model, request: {} }],
        reservedMessages: [],
        listeners: [sub]
      })
    )
    mocks.send.mockReset()
    mocks.hasLiveStream.mockReset().mockReturnValue(false)
    mocks.isSessionBusy.mockReset().mockReturnValue(false)
    mocks.closeSession.mockReset().mockResolvedValue(undefined)
  })

  function input(handoffId = randomUUID(), overrides: Record<string, unknown> = {}) {
    return {
      handoffId,
      source: { kind: 'topic' as const, id: sourceTopicId },
      targetAgentId: currentAgent.id as string,
      workspace: { type: 'system' as const },
      goal: 'Fix the confirmed regression without deploying.',
      summary: 'The failing invariant is E_HANDOFF_42.',
      attachmentParts: [],
      ...overrides
    }
  }

  it('concurrently confirms one payload into one session, user, assistant, and runtime start', async () => {
    const handoffId = randomUUID()
    const [first, second] = await Promise.all([
      startHandoff(input(handoffId), listener),
      startHandoff(input(handoffId), listener)
    ])

    expect([first.state, second.state].sort()).toEqual(['existing', 'started'])
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, handoffId)).all()).toHaveLength(1)
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, handoffId)).all()
    ).toHaveLength(2)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('rejects the same handoff ID with a different payload without overwriting the first turn', async () => {
    const handoffId = randomUUID()
    await expect(startHandoff(input(handoffId), listener)).resolves.toMatchObject({ state: 'started' })
    await expect(startHandoff(input(handoffId, { goal: 'A different task.' }), listener)).rejects.toMatchObject({
      name: 'HandoffStartConflictError'
    })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('writes one source display marker atomically and does not start a source model turn', async () => {
    const source = topicService.create({ name: 'Source discussion' })
    const handoffId = randomUUID()
    const before = dbh.db.select().from(messageTable).where(eq(messageTable.topicId, source.id)).all()
    const result = await startHandoff(
      input(handoffId, { source: { kind: 'topic', id: source.id, name: source.name } }),
      listener
    )

    expect(result.state).toBe('started')
    const after = dbh.db.select().from(messageTable).where(eq(messageTable.topicId, source.id)).all()
    expect(after).toHaveLength(before.length + 1)
    expect(after.at(-1)?.role).toBe('assistant')
    expect(after.at(-1)?.data.parts?.[0]?.type).toBe('data-handoff')
    expect(mocks.send.mock.calls[0]?.[0]?.topicId).toBe(`agent-session:${handoffId}`)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('rolls back the target session when the atomic source marker cannot be written', async () => {
    const handoffId = randomUUID()
    await expect(
      startHandoff(input(handoffId, { source: { kind: 'topic', id: 'missing-source-topic' } }), listener)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, handoffId)).all()).toHaveLength(0)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('keeps the created session and pending pair when target validation fails, then retries it', async () => {
    mocks.validateDispatch.mockRejectedValueOnce(new Error('workspace unavailable'))
    const handoffId = randomUUID()
    const failed = await startHandoff(input(handoffId), listener)
    expect(failed).toMatchObject({
      sessionId: handoffId,
      state: 'created',
      error: { message: 'workspace unavailable' }
    })
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, handoffId)).all()
    ).toHaveLength(2)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.validateDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: `agent-session:${handoffId}` })
    )

    await expect(startHandoff(input(handoffId), listener)).resolves.toMatchObject({ state: 'started' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('terminalizes an activation/send failure without replaying the claimed first turn', async () => {
    mocks.activateDispatch.mockImplementationOnce(() => {
      throw new Error('activation failed')
    })
    const handoffId = randomUUID()
    const failed = await startHandoff(input(handoffId), listener)
    expect(failed).toMatchObject({ state: 'created', error: { message: 'activation failed' } })
    expect(
      agentSessionMessageService.listSessionMessages(handoffId).items.find((message) => message.role === 'assistant')
        ?.status
    ).toBe('error')
    await expect(startHandoff(input(handoffId), listener)).resolves.toMatchObject({ state: 'existing' })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.closeSession).toHaveBeenCalledWith(handoffId)
  })

  it('finds the stable assistant after normal completion replaced its handoff marker', async () => {
    const handoffId = randomUUID()
    await expect(startHandoff(input(handoffId), listener)).resolves.toMatchObject({ state: 'started' })
    const assistant = agentSessionMessageService
      .listSessionMessages(handoffId)
      .items.find((message) => message.role === 'assistant')!
    agentSessionMessageService.replaceMessageParts(handoffId, assistant.id, [
      { type: 'text', text: 'completed answer' }
    ])
    dbh.db
      .update(agentSessionMessageTable)
      .set({ status: 'success' })
      .where(eq(agentSessionMessageTable.id, assistant.id))
      .run()

    await expect(startHandoff(input(handoffId), listener)).resolves.toMatchObject({ state: 'existing' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('keeps execution ownership when send throws after a live stream handoff', async () => {
    let live = false
    mocks.send.mockImplementationOnce(() => {
      live = true
      throw new Error('lifecycle callback failed')
    })
    mocks.hasLiveStream.mockImplementation(() => live)
    const handoffId = randomUUID()
    const result = await startHandoff(input(handoffId), listener)
    expect(result).toMatchObject({ state: 'started', error: { message: 'lifecycle callback failed' } })
    expect(mocks.closeSession).not.toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('terminalizes a send failure before live ownership and does not replay it', async () => {
    mocks.send.mockImplementationOnce(() => {
      throw new Error('send failed before handoff')
    })
    const handoffId = randomUUID()
    const result = await startHandoff(input(handoffId), listener)
    expect(result).toMatchObject({ state: 'created', error: { message: 'send failed before handoff' } })
    expect(
      agentSessionMessageService.listSessionMessages(handoffId).items.find((message) => message.role === 'assistant')
        ?.status
    ).toBe('error')
    await expect(startHandoff(input(handoffId), listener)).resolves.toMatchObject({ state: 'existing' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.closeSession).toHaveBeenCalledWith(handoffId)
  })

  it('includes source readback in the target user text and preserves target model/workspace', async () => {
    const sourceId = sourceTopicId
    const handoffId = randomUUID()
    await startHandoff(input(handoffId, { source: { kind: 'topic', id: sourceId } }), listener).catch(() => undefined)
    const user = agentSessionMessageService
      .listSessionMessages(handoffId)
      .items.find((message) => message.role === 'user')
    expect(user?.data.parts?.find((part) => part.type === 'text')).toMatchObject({
      text: expect.stringContaining(`Original session: ${sourceId}`)
    })
    expect(mocks.validateDispatch.mock.calls.at(-1)?.[0].userMessageParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining(`Original session: ${sourceId}`) })
      ])
    )
    const session = agentSessionService.getById(handoffId)
    expect(session.agentId).toBe(currentAgent.id)
    expect(session.workspace.type).toBe('system')
    expect(
      agentSessionMessageService.listSessionMessages(handoffId).items.find((message) => message.role === 'assistant')
        ?.modelId
    ).toBe(currentAgent.model)
  })

  it('does not create while quiesced and leaves a pending placeholder when the target changes during validation', async () => {
    mocks.isWriteQuiesced = true
    await expect(startHandoff(input(), listener)).rejects.toThrow('write-quiesced')
    mocks.isWriteQuiesced = false
    mocks.validateDispatch.mockImplementationOnce(async () => {
      currentAgent = { ...currentAgent, updatedAt: '2026-09-07T00:01:00.000Z' }
      return {
        sessionId: 'handoff-session',
        agentUpdatedAt: '2026-09-07T00:00:00.000Z',
        agentType: 'claude-code',
        uniqueModelId: 'target-provider::target-model',
        userMessageParts: [],
        userMessageId: 'ignored'
      }
    })
    const handoffId = randomUUID()
    const result = await startHandoff(input(handoffId), listener)
    expect(result).toMatchObject({ state: 'created', error: { message: expect.stringContaining('changed') } })
    expect(
      agentSessionMessageService.listSessionMessages(handoffId).items.find((message) => message.role === 'assistant')
        ?.status
    ).toBe('error')
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
