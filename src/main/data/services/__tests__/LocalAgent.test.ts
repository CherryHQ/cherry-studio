import '@data/services/AgentGlobalSkillService'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { userModelTable } from '@data/db/schemas/userModel'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { createAgent } from '@main/ai/agents/createAgent'
import { AgentSessionMessageBackend } from '@main/ai/agentSession/persistence/AgentSessionMessageBackend'
import { LocalRuntimeDriver } from '@main/ai/runtime/localAgent/LocalRuntimeDriver'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import { AgentChatContextProvider } from '@main/ai/streamManager/context/AgentChatContextProvider'
import { getProviderModelId } from '@shared/ai/executionIdentity'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

const config: LocalAgentConfiguration = { presetId: 'codex', protocol: 'codex', enabled: true, args: [], env: {} }

describe('local agents on migrated SQLite', () => {
  const database = setupTestDatabase()
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'cherry-local-agent-db-'))
    vi.mocked(application.getPath).mockReturnValue(directory)
    runtimeDriverRegistry.register(new LocalRuntimeDriver())
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const request = () => ({
    type: 'local' as const,
    name: 'Codex',
    model: null,
    configuration: { localRuntime: { ...config } }
  })

  it('creates one preset identity under concurrent enables and retains it across disable/re-enable', async () => {
    const [a, b] = await Promise.all([createAgent(request()), createAgent(request())])
    expect(a.id).toBe(b.id)
    expect(database.db.select().from(agentTable).all()).toHaveLength(1)
    const session = agentSessionService.create({ name: 'Test session', agentId: a.id, workspace: { type: 'system' } })
    const user = agentSessionMessageService.saveMessage({
      sessionId: session.id,
      message: { role: 'user', data: { parts: [{ type: 'text', text: 'retained history' }] } }
    })
    agentService.updateAgent(a.id, { configuration: { localRuntime: { ...config, enabled: false } } })
    expect(() =>
      agentSessionService.create({ name: 'Test session', agentId: a.id, workspace: { type: 'system' } })
    ).toThrow('disabled')
    await expect(
      new AgentChatContextProvider().validateDispatch({
        topicId: `agent-session:${session.id}`,
        trigger: 'submit-message',
        userMessageParts: [{ type: 'text', text: 'blocked' }]
      })
    ).rejects.toThrow('disabled')
    const enabled = await createAgent(request())
    expect(enabled.id).toBe(a.id)
    expect(enabled.orderKey).toBe(a.orderKey)
    expect(agentSessionMessageService.getSessionMessage(session.id, user.id).data.parts).toEqual([
      { type: 'text', text: 'retained history' }
    ])
    expect(database.db.select().from(userModelTable).all()).toHaveLength(0)
  })

  it('persists a native model choice and clears it when following the CLI again', async () => {
    const agent = await createAgent(request())
    const session = agentSessionService.create({
      name: 'Model selection',
      agentId: agent.id,
      workspace: { type: 'system' }
    })
    agentService.updateAgent(agent.id, { configuration: { localRuntime: { ...config, nativeModel: 'cli-model' } } })
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('cli-model')
    agentService.updateAgent(agent.id, { configuration: { localRuntime: { ...config } } })
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBeUndefined()
    expect(agentSessionService.getById(session.id).agentId).toBe(agent.id)
    expect(database.db.select().from(userModelTable).all()).toHaveLength(0)
  })

  it('routes and persists a native-model reply without a provider/model foreign key', async () => {
    const agent = await createAgent(request())
    const session = agentSessionService.create({
      name: 'Test session',
      agentId: agent.id,
      workspace: { type: 'system' }
    })
    const context = new AgentChatContextProvider()
    const validated = await context.validateDispatch({
      topicId: `agent-session:${session.id}`,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'hello' }]
    })
    expect(validated.uniqueModelId).toBe(`runtime:${agent.id}`)
    expect(getProviderModelId(validated.uniqueModelId)).toBeUndefined()
    const persisted = application.get('DbService').withWriteTx((tx) =>
      context.persistDispatchTx(tx, validated, {
        id: agent.id,
        updatedAt: agent.updatedAt,
        model: null,
        type: 'local'
      })
    )
    const snapshot = { ...validated.messageSnapshot, nativeModel: { runtime: 'codex', id: 'native-model' } }
    const backend = new AgentSessionMessageBackend({
      sessionId: session.id,
      assistantMessageId: persisted.assistantMessageId,
      runtimeResumeToken: 'native-thread',
      messageSnapshot: () => snapshot
    })
    const usageRecord = {
      requestId: 'acp:test-turn',
      context: {
        providerId: 'local-agent:kilo',
        providerName: null,
        modelId: 'kilo/kilo-auto/free',
        modelName: null,
        pricingSnapshot: null,
        trustProviderReportedCost: false,
        reportedCostCurrency: null,
        credentialReceipt: { attribution: 'auth' as const, method: 'external-cli' as const },
        source: { type: 'agent' as const, id: agent.id, name: agent.name, icon: null },
        messageRef: { kind: 'agent-session' as const, id: persisted.assistantMessageId }
      },
      modality: 'language' as const,
      usage: {
        inputTokens: 150,
        outputTokens: 25,
        totalTokens: 175,
        noCacheTokens: 100,
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
        reasoningTokens: 5
      },
      completedAt: Date.now()
    }
    aiUsageRecordService.recordInvocation(usageRecord)
    aiUsageRecordService.recordInvocation(usageRecord)
    backend.persistAssistant({
      status: 'success',
      finalMessage: { id: persisted.assistantMessageId, role: 'assistant', parts: [{ type: 'text', text: 'world' }] }
    })
    const message = agentSessionMessageService.getSessionMessage(session.id, persisted.assistantMessageId)
    expect(message.stats).toMatchObject({
      inputTokens: 150,
      outputTokens: 25,
      totalTokens: 175,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 40, cacheWriteTokens: 10 },
      outputTokenDetails: { reasoningTokens: 5 }
    })
    expect(message.stats?.timeCompletionMs).toBeUndefined()
    expect(message.modelId).toBeNull()
    expect(message.messageSnapshot).toEqual(snapshot)
    expect(message.runtimeResumeToken).toBe('native-thread')
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('preserves history instead of silently starting a fresh native session after losing its restore token', async () => {
    const agent = await createAgent(request())
    const session = agentSessionService.create({
      name: 'Interrupted',
      agentId: agent.id,
      workspace: { type: 'system' }
    })
    for (const text of ['previous turn', 'interrupted turn', 'next turn']) {
      agentSessionMessageService.saveMessage({
        sessionId: session.id,
        message: { role: 'user', data: { parts: [{ type: 'text', text }] } }
      })
    }
    await expect(
      new LocalRuntimeDriver().connect({ sessionId: session.id, agentId: agent.id, modelId: `runtime:${agent.id}` })
    ).rejects.toThrow('cannot be restored')
    expect(agentSessionMessageService.listSessionMessages(session.id).items).toHaveLength(3)
  })

  it('keeps protocol, preset, and session directory immutable and rejects Cherry model/resources', async () => {
    const agent = await createAgent(request())
    const session = agentSessionService.create({
      name: 'Test session',
      agentId: agent.id,
      workspace: { type: 'system' }
    })
    expect(() =>
      agentService.updateAgent(agent.id, { configuration: { localRuntime: { ...config, protocol: 'acp' } } })
    ).toThrow('Protocol and preset')
    expect(() => agentService.updateAgent(agent.id, { configuration: { localRuntime: undefined } })).toThrow()
    expect(() => agentService.updateAgent(agent.id, { configuration: { heartbeat_enabled: true } })).toThrow(
      'own their model'
    )
    expect(() => agentSessionService.setWorkspace(session.id, { type: 'system' })).not.toThrow()
    agentSessionMessageService.saveMessage({
      sessionId: session.id,
      message: { role: 'user', data: { parts: [{ type: 'text', text: 'lock directory' }] } }
    })
    expect(() => agentSessionService.setWorkspace(session.id, { type: 'system' })).toThrow('after messages')
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime).toEqual(config)
  })
})
