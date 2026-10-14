import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RemoteRpcError, RemoteRpcServer } from '@cherrystudio/remote-transport'
import { assistantTable } from '@data/db/schemas/assistant'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import type { StreamListener } from '@main/ai/streamManager'
import type { DispatchContext } from '@main/ai/streamManager/context/ChatContextProvider'
import type { MainDispatchRequest } from '@main/ai/streamManager/context/dispatch'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'

import { createAssistantSubscriptions, registerAssistantMethods } from '../assistantHandlers'
import { RemoteAssistantHub } from '../assistantJournal'
import { assistantRevision, getAssistant, getAssistantTopic } from '../assistantQueries'

const fake = vi.hoisted(() => ({
  manager: {
    dispatch: vi.fn(),
    inspect: () => undefined,
    hasLiveStream: () => false,
    hasUnsettledTopicWork: () => false,
    removeListener() {}
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'AiStreamManager') return fake.manager
    return originalGet(name)
  })
  return result
})

describe('Accepted Assistant command authorization', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['disconnect', 'revoke', 'rotate'] as const)(
    'keeps accepted work independent of its connection while checking persisted authority: %s',
    async (change) => {
      const modelId = createUniqueModelId('openai', 'gpt-4o')
      dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' }).run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: modelId,
          providerId: 'openai',
          modelId: 'gpt-4o',
          name: 'GPT-4o',
          isEnabled: true,
          orderKey: 'a0'
        })
        .run()
      dbh.db
        .insert(assistantTable)
        .values({
          id: 'assistant',
          name: 'Assistant',
          emoji: '🍒',
          modelId,
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0'
        })
        .run()
      const topic = topicService.create({ name: 'Remote topic', assistantId: 'assistant' })
      const metadata = { name: 'Phone', platform: 'ios', peerIdentity: 'phone', capabilities: ['assistant'] as const }
      const { device, authorization } = apiGatewayPairedDeviceService.approveRemote({
        ...metadata,
        capabilities: [...metadata.capabilities]
      })
      let connected = true
      const preparing = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      fake.manager.dispatch.mockImplementation(
        async (_observer: StreamListener, req: MainDispatchRequest, admission: DispatchContext) => {
          if (req.trigger !== 'submit-message') throw new Error('Expected a submit')
          admission.beforePersist?.()
          messageService.createUserMessageWithPlaceholders(
            {
              topicId: req.topicId,
              userMessage: {
                mode: 'create',
                dto: { role: 'user', status: 'success', data: { parts: req.userMessageParts } }
              },
              placeholders: [{ role: 'assistant', status: 'pending', modelId, data: { parts: [] } }]
            },
            { beforePersist: admission.beforePersist, onPersist: admission.onPersist }
          )
          preparing.resolve()
          await resume.promise
          admission.beforeActivate?.()
          return { mode: 'started' }
        }
      )
      const rpc = new RemoteRpcServer<void>(() => {})
      const hub = new RemoteAssistantHub()
      const subscriptions = createAssistantSubscriptions(hub, async () => {})
      registerAssistantMethods(
        rpc,
        {
          requireAssistant: () => {
            if (!connected) throw new RemoteRpcError('UNAUTHENTICATED', 'Connection closed')
            return { deviceId: device.id, grantId: authorization.grants[0].grantId, peerIdentity: 'phone' }
          },
          afterReply: (fn) => fn()
        },
        hub,
        subscriptions
      )
      const view = getAssistantTopic(topic.id)
      const params = {
        commandId: 'send',
        topicId: topic.id,
        assistantId: 'assistant',
        expectedAssistantRevision: assistantRevision(getAssistant('assistant')),
        parentAnchorId: view.parentAnchorId,
        expectedHistoryRevision: view.historyRevision,
        text: 'Accepted question'
      }
      const send = () =>
        rpc.receive({ jsonrpc: '2.0', id: 'send', method: 'assistant.messages.send', params }, undefined)
      try {
        const pending = send()
        await Promise.race([
          preparing.promise,
          pending.then(() => {
            throw new Error('Command ended before preparation')
          })
        ])
        connected = false
        subscriptions.dispose()
        if (change !== 'disconnect') apiGatewayPairedDeviceService.revokeRemoteCapability(device.id, 'assistant')
        if (change === 'rotate')
          apiGatewayPairedDeviceService.approveRemote({ ...metadata, capabilities: [...metadata.capabilities] })
        resume.resolve()
        const response = await pending
        expect(response).toMatchObject({
          result: { status: change === 'disconnect' ? 'applied' : 'interrupted', executionId: expect.any(String) }
        })
        if (change === 'disconnect') {
          connected = true
          expect(await send()).toEqual(response)
        } else expect(response).toMatchObject({ result: { error: { reason: 'GRANT_REVOKED' } } })
        const messages = messageService.getPathToNode(topicService.getById(topic.id).activeNodeId!)
        expect(messages.filter((message) => message.role === 'user')).toMatchObject([
          { data: { parts: [{ text: 'Accepted question' }] } }
        ])
        expect(messages.filter((message) => message.role === 'assistant')).toMatchObject([
          { status: change === 'disconnect' ? 'pending' : 'error' }
        ])
      } finally {
        resume.resolve()
        subscriptions.dispose()
        hub.dispose()
      }
    }
  )
})
