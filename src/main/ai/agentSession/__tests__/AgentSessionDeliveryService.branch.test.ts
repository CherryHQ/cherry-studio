import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { readUIMessageStream } from 'ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeEvent } from '@main/ai/runtime/types'
import type { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { createUniqueModelId } from '@shared/data/types/model'
import { AsyncEventQueue, KeyedMutex } from '@shared/utils/async'

import { AgentSessionDeliveryService } from '../AgentSessionDeliveryService'
import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'

const modelId = createUniqueModelId('branch-provider', 'branch-model')

describe('durable delivery native branch admission', () => {
  const dbh = setupTestDatabase()
  let runtime: AgentSessionRuntimeService
  const closed: string[] = []
  const consumed: string[] = []
  let completion: Promise<string> | undefined
  let closeBarrier: (() => Promise<void>) | undefined

  beforeEach(() => {
    BaseService.resetInstances()
    runtimeDriverRegistry.clearForTest()
    closed.length = 0
    consumed.length = 0
    completion = undefined
    closeBarrier = undefined
    runtime = new AgentSessionRuntimeService()
    const lock = new KeyedMutex()
    MockApplicationUtils.setService('AgentSessionRuntimeService', runtime)
    MockApplicationUtils.setService('AiStreamManager', {
      isWriteQuiesced: false,
      withDispatchLock: (topic: string, operation: () => Promise<void>) => lock.runExclusive(topic, operation),
      whenTerminalDispatchSettled: async () => {},
      hasLiveStream: () => false,
      hasUnsettledTopicWork: () => false,
      terminateHeldTopicStream: () => {},
      send: (input: Parameters<AiStreamManager['send']>[0]) => {
        const request = input.models[0].request.runtime!
        if (request.kind !== 'agent-session') throw new Error('Expected an agent session')
        const source = runtime.openTurnStream({ ...request, signal: new AbortController().signal })
        if (source.kind !== 'chunks') throw new Error('Expected the fixture driver to produce chunks')
        completion = (async () => {
          let text = ''
          for await (const message of readUIMessageStream({ stream: source.stream }))
            text = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
          runtime.markTurnTerminal(request.sessionId, 'success')
          return text
        })()
      }
    })
    runtimeDriverRegistry.register({
      type: 'pi',
      capabilities: ['agent-session'],
      validateSession: async () => {},
      listAvailableTools: async () => [],
      connect: async ({ resumeToken }) => {
        const branch = resumeToken ?? 'missing-history'
        const events = new AsyncEventQueue<AgentRuntimeEvent>()
        return {
          events,
          reconcile: async () => 'current' as const,
          send: () => {
            consumed.push(branch)
            events.push({ type: 'chunk', chunk: { type: 'text-start', id: 'reply' } })
            events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 'reply', delta: `history:${branch}` } })
            events.push({ type: 'chunk', chunk: { type: 'text-end', id: 'reply' } })
            events.push({ type: 'chunk', chunk: { type: 'finish', finishReason: 'stop' } })
            events.push({ type: 'turn-complete' })
          },
          close: async () => {
            await closeBarrier?.()
            closed.push(branch)
            events.close()
          }
        }
      }
    })
    dbh.db.insert(userProviderTable).values({ providerId: 'branch-provider', name: 'Branch', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: modelId,
        providerId: 'branch-provider',
        modelId: 'branch-model',
        name: 'Branch',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'pi', name: 'Agent', instructions: 'test', model: modelId, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'work', type: 'user', name: 'Work', path: '/tmp', orderKey: 'a0' })
      .run()
    for (const id of ['source', 'target'])
      dbh.db
        .insert(agentSessionTable)
        .values({ id, agentId: 'agent', workspaceId: 'work', name: id, orderKey: id })
        .run()
  })

  afterEach(async () => {
    closeBarrier = undefined
    await runtime.closeSession('target')
    MockApplicationUtils.resetServices()
    runtimeDriverRegistry.clearForTest()
    BaseService.resetInstances()
  })

  async function prepare() {
    const root = messages.captureHead('target')
    const a = messages.saveMessage({
      sessionId: 'target',
      parentId: root,
      runtimeResumeToken: 'native-A',
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'A history' }] } }
    })
    await runtime.primeConnection('target')
    expect(runtime.getExecutionHead('target')).toBe(a.id)
    const b = messages.saveMessage({
      sessionId: 'target',
      parentId: root,
      runtimeResumeToken: 'native-B',
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'B history' }] } }
    })
    messages.selectBranch('target', b.id)
    const delivery = messages.acceptSessionDelivery({
      senderAgentId: 'agent',
      senderSessionId: 'source',
      receiverSessionId: 'target',
      content: 'Continue B'
    })
    expect(messages.sharesBranch('target', b.id, delivery.id)).toBe(true)
    expect(messages.sharesBranch('target', a.id, delivery.id)).toBe(false)
    messages.selectBranch('target', a.id)
    return { delivery, b }
  }

  it('replaces an idle A connection with B history despite a later UI selection of A', async () => {
    const { delivery, b } = await prepare()
    const service = new AgentSessionDeliveryService()
    service.kick('target')
    await service.drainSessionQueues(['target'])
    expect(await completion).toBe('history:native-B')
    expect(consumed).toEqual(['native-B'])
    expect(closed).toContain('native-A')
    const claimed = messages.getSessionMessage('target', delivery.id)
    expect(claimed.delivery?.status).toBe('delivering')
    expect(messages.sharesBranch('target', b.id, claimed.delivery!.turnRef!)).toBe(true)
  })

  it('does not claim or run a delivery cancelled while the old connection closes', async () => {
    const { delivery } = await prepare()
    const closing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    closeBarrier = async () => {
      closing.resolve()
      await release.promise
    }
    const service = new AgentSessionDeliveryService()
    service.kick('target')
    await closing.promise
    messages.failSessionDelivery(delivery, { code: 'CANCELLED', message: 'cancelled during branch switch' })
    release.resolve()
    await service.drainSessionQueues(['target'])
    expect(consumed).toEqual([])
    expect(messages.getSessionMessage('target', delivery.id).delivery?.status).toBe('failed')
    expect(completion).toBeUndefined()
  })
})
