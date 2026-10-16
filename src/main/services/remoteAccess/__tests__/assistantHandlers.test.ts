import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
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
import { FileIntakeError } from '@main/services/file'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { createAssistantSubscriptions, registerAssistantMethods } from '../assistantHandlers'
import { RemoteAssistantHub } from '../assistantJournal'
import { assistantRevision, getAssistant, getAssistantTopic } from '../assistantQueries'
import { RemoteUploads } from '../RemoteUploads'

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

const dbh = setupTestDatabase()

function seedAssistant(db: ReturnType<typeof setupTestDatabase>['db']) {
  const modelId = createUniqueModelId('openai', 'gpt-4o')
  db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' }).run()
  db.insert(userModelTable)
    .values({
      id: modelId,
      providerId: 'openai',
      modelId: 'gpt-4o',
      name: 'GPT-4o',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      orderKey: 'a0'
    })
    .run()
  db.insert(assistantTable)
    .values({
      id: 'assistant',
      name: 'Assistant',
      emoji: '🍒',
      modelId,
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: 'a0'
    })
    .run()
  return modelId
}

describe('Accepted Assistant command authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['disconnect', 'revoke', 'rotate'] as const)(
    'keeps accepted work independent of its connection while checking persisted authority: %s',
    async (change) => {
      const modelId = seedAssistant(dbh.db)
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
        subscriptions,
        new RemoteUploads()
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

describe('Remote Assistant attachments', () => {
  const bytes = Buffer.from('desktop-owned attachment')
  const entry = {
    entryId: randomUUID(),
    filename: 'report.txt',
    mediaType: 'text/plain',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
  const setup = () => {
    const modelId = seedAssistant(dbh.db)
    const topic = topicService.create({ name: 'Remote topic', assistantId: 'assistant' })
    const { device, authorization } = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['assistant']
    })
    fake.manager.dispatch.mockReset()
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
        requireAssistant: () => ({
          deviceId: device.id,
          grantId: authorization.grants[0].grantId,
          peerIdentity: 'phone'
        }),
        afterReply: (fn) => fn()
      },
      hub,
      subscriptions,
      new RemoteUploads()
    )
    const call = async (method: string, params: unknown) =>
      (await rpc.receive({ jsonrpc: '2.0', id: randomUUID(), method, params }, undefined)) as {
        result?: any
        error?: any
      }
    const view = getAssistantTopic(topic.id)
    const send = {
      commandId: randomUUID(),
      topicId: topic.id,
      assistantId: 'assistant',
      expectedAssistantRevision: assistantRevision(getAssistant('assistant')),
      parentAnchorId: view.parentAnchorId,
      expectedHistoryRevision: view.historyRevision,
      text: 'Read this',
      attachments: [{ uploadId: 'upload' }]
    }
    const dispose = () => {
      subscriptions.dispose()
      hub.dispose()
    }
    return { topic, call, send, dispose }
  }

  it('sends verified uploads after the text, replays the receipt and serves the bytes back from history', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'assistant-attachment-'))
    const { topic, call, send, dispose } = setup()
    try {
      const physical = AbsoluteFilePathSchema.parse(path.join(root, 'report.txt'))
      await writeFile(physical, bytes)
      vi.mocked(application.get('FileManager').getPhysicalPath).mockReturnValue(physical)
      vi.mocked(application.get('FileIntakeService').withEntries).mockImplementation(
        async (_owner, refs: { uploadId: string }[], run: (entries: (typeof entry)[]) => Promise<unknown>) =>
          run(refs.map(() => entry))
      )
      const receipt = (await call('assistant.messages.send', send)).result
      expect(receipt.status).toBe('applied')
      expect((await call('assistant.messages.send', send)).result).toEqual(receipt)
      expect(fake.manager.dispatch).toHaveBeenCalledTimes(1)

      const view = getAssistantTopic(topic.id)
      const scope = { topicId: topic.id, parentAnchorId: view.parentAnchorId, historyRevision: view.historyRevision }
      const user = (await call('assistant.messages.list', scope)).result.items.find(
        (message: { role: string }) => message.role === 'user'
      )
      const parts = (
        await call('assistant.parts.list', { ...scope, messageId: user.messageId, messageRevision: user.revision })
      ).result.items
      expect(parts.map((part: { kind: string }) => part.kind)).toEqual(['text', 'file'])
      expect(parts[1]).toMatchObject({
        name: 'report.txt',
        ref: { sha256: entry.sha256, byteLength: String(bytes.length) }
      })
      const stored = messageService.getById(user.messageId).data.parts?.[1]
      expect(stored?.type === 'file' && readCherryMeta(stored)?.fileEntryId).toBe(entry.entryId)

      const read = { ...scope, contentId: parts[1].ref.contentId, offset: '0', maxBytes: 24576 }
      const page = (await call('assistant.content.read', { ...read, revision: parts[1].ref.revision })).result
      expect(Buffer.from(page.dataBase64, 'base64')).toEqual(bytes)
      expect(page).toMatchObject({ eof: true, sha256: entry.sha256 })
      expect((await call('assistant.content.read', { ...read, revision: '999' })).error).toMatchObject({
        data: { reason: 'REVISION_EXPIRED' }
      })
    } finally {
      dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a send whose upload is not ready without reserving messages', async () => {
    const { topic, call, send, dispose } = setup()
    try {
      vi.mocked(application.get('FileIntakeService').withEntries).mockRejectedValue(
        new FileIntakeError('CONFLICT', 'Attachment is not ready')
      )
      expect((await call('assistant.messages.send', send)).result).toMatchObject({
        status: 'rejected',
        error: { reason: 'CONFLICT' }
      })
      expect(fake.manager.dispatch).not.toHaveBeenCalled()
      expect(getAssistantTopic(topic.id).parentAnchorId).toBeNull()
    } finally {
      dispose()
    }
  })
})
