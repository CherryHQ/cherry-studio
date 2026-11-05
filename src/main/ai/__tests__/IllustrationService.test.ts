import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { chatMessageFileRefTable } from '@main/data/db/schemas/fileRelations'
import { topicTable } from '@main/data/db/schemas/topic'
import { userModelTable } from '@main/data/db/schemas/userModel'
import { userProviderTable } from '@main/data/db/schemas/userProvider'
import { messageService } from '@main/data/services/MessageService'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'

import { IllustrationService } from '../IllustrationService'
import { AiStreamManager } from '../streamManager/AiStreamManager'
import { MessageServiceBackend } from '../streamManager/persistence/backends/MessageServiceBackend'
import { TemporaryChatBackend } from '../streamManager/persistence/backends/TemporaryChatBackend'
import type { StreamDoneResult, StreamListener } from '../streamManager/types'
import type { AiStreamRequest } from '../types/requests'

vi.mock('../tools/painting', () => ({
  resolveConfiguredPaintingModel: () => ({ uniqueModelId: 'provider::image', support: null }),
  extractParamValues: () => ({})
}))

describe('illustration persistence and task ownership', () => {
  const dbh = setupTestDatabase()
  const fileId = '019606a0-0000-7000-8000-00000000fd01'
  let service: IllustrationService
  let finish: (value: { files: { id: string; name: string }[] }) => void
  let fail: (reason: Error) => void
  let generate: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    BaseService.resetInstances()
    service = new IllustrationService()
    generate = vi.fn(
      () =>
        new Promise<{ files: { id: string; name: string }[] }>((resolve, reject) => {
          finish = resolve
          fail = reject
        })
    )
    MockApplicationUtils.setService('IllustrationService', service)
    MockApplicationUtils.setService('AiService', { generateImage: generate })
    MockApplicationUtils.setService('RuntimeActivityService', { begin: () => ({ dispose: () => {} }) })
    await application.get('PreferenceService').setMultiple({
      'chat.illustration.mode': 'auto',
      'chat.illustration.max_count': 1,
      'chat.illustration.target_count': 1
    })
    dbh.db.insert(fileEntryTable).values({ id: fileId, origin: 'internal', name: 'bird', ext: 'png', size: 1 }).run()
  })

  function createReply(modelId?: string) {
    dbh.db.insert(topicTable).values({ id: 'topic', orderKey: 'a0' }).run()
    const root = messageService.createRootMessageTx(dbh.db, 'topic')
    return messageService.create('topic', {
      parentId: root,
      role: 'assistant',
      modelId,
      siblingsGroupId: modelId ? 1 : 0,
      data: { parts: [] },
      status: 'pending'
    })
  }

  function seed() {
    const message = createReply()
    const target = { topicId: 'topic', messageId: message.id, id: 'illustration' }
    service.start(target, new AbortController().signal)
    const data = service.complete(target, 'a bird', true)
    const parts: CherryMessagePart[] = [
      { type: 'text', text: 'before' },
      { type: 'data-illustration', id: target.id, data },
      { type: 'text', text: 'after' }
    ]
    return { target, parts, backend: new MessageServiceBackend({ assistantMessageId: message.id }) }
  }

  // Catches mode lookup before stream registration silently disabling every fresh reply.
  it('streams later text and persists the reserved position before a delayed illustration finishes', async () => {
    const message = createReply()
    const backend = new MessageServiceBackend({ assistantMessageId: message.id })
    let upstream!: ReadableStreamDefaultController<UIMessageChunk>
    const streamText = vi.fn(
      async () =>
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            upstream = controller
          }
        })
    )
    MockApplicationUtils.setService('AiService', { streamText, generateImage: generate })
    const chunks: UIMessageChunk[] = []
    const listener: StreamListener = {
      id: 'illustration-test',
      terminalPhase: 'persistence',
      onChunk(chunk) {
        chunks.push(chunk)
      },
      async onDone(result) {
        await backend.persistAssistant({ finalMessage: result.finalMessage, status: 'success' })
      },
      onPaused() {},
      onError() {},
      isAlive: () => true
    }
    const manager = new AiStreamManager()
    manager.send({
      topicId: 'topic',
      isPersistentConversation: true,
      models: [
        {
          modelId: 'provider::text',
          request: {
            conversation: { id: 'topic', topicId: 'topic' },
            trigger: 'submit-message',
            messageId: message.id,
            messages: []
          }
        }
      ],
      listeners: [listener]
    })
    await vi.waitFor(() => expect(streamText).toHaveBeenCalled())
    upstream.enqueue({ type: 'start', messageId: message.id })
    upstream.enqueue({ type: 'text-start', id: 'text' })
    upstream.enqueue({ type: 'text-delta', id: 'text', delta: 'before\n[[IMAGE]]' })
    await vi.waitFor(() => expect(chunks.some((chunk) => chunk.type === 'data-illustration')).toBe(true))
    expect(generate).not.toHaveBeenCalled()
    upstream.enqueue({ type: 'text-delta', id: 'text', delta: 'a bird[[/IMAGE]]\nafter' })
    upstream.enqueue({ type: 'text-end', id: 'text' })
    upstream.enqueue({ type: 'finish', finishReason: 'stop' })
    upstream.close()
    await vi.waitFor(() => expect(messageService.getById(message.id).status).toBe('success'))
    expect(messageService.getById(message.id).data.parts).toEqual([
      expect.objectContaining({ type: 'text', text: 'before\n' }),
      expect.objectContaining({ type: 'data-illustration', data: expect.objectContaining({ status: 'generating' }) }),
      expect.objectContaining({ type: 'text', text: '\nafter' })
    ])
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    finish({ files: [{ id: fileId, name: 'bird' }] })
    await vi.waitFor(() =>
      expect(messageService.getById(message.id).data.parts?.[1]).toMatchObject({ data: { status: 'ready' } })
    )
  })

  // Catches settings being shown but omitted from either the model request or stream admission.
  it.each([
    { mode: 'auto', maxCount: 2, targetCount: 1 },
    { mode: 'on', maxCount: 8, targetCount: 2 },
    { mode: 'on', maxCount: 1, targetCount: 2 }
  ] as const)(
    'uses $mode quantity with maximum $maxCount and target $targetCount',
    async ({ mode, maxCount, targetCount }) => {
      await application.get('PreferenceService').setMultiple({
        'chat.illustration.mode': mode,
        'chat.illustration.max_count': maxCount,
        'chat.illustration.target_count': targetCount
      })
      const message = createReply()
      generate.mockResolvedValue({ files: [{ id: fileId, name: 'bird' }] })
      const streamText = vi.fn(async (request: AiStreamRequest) => {
        await application.get('PreferenceService').setMultiple({
          'chat.illustration.mode': 'off',
          'chat.illustration.max_count': 9,
          'chat.illustration.target_count': 9
        })
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            const chunks: UIMessageChunk[] = [
              { type: 'start', messageId: request.messageId },
              { type: 'text-start', id: 'text' },
              {
                type: 'text-delta',
                id: 'text',
                delta: '[[IMAGE]]first[[/IMAGE]]\n[[IMAGE]]second[[/IMAGE]]\n[[IMAGE]]excess[[/IMAGE]]\nAfter'
              },
              { type: 'text-end', id: 'text' },
              { type: 'finish', finishReason: 'stop' }
            ]
            chunks.forEach((chunk) => controller.enqueue(chunk))
            controller.close()
          }
        })
      })
      MockApplicationUtils.setService('AiService', { streamText, generateImage: generate })
      let result: StreamDoneResult | undefined
      new AiStreamManager().send({
        topicId: 'topic',
        isPersistentConversation: true,
        models: [
          {
            modelId: 'provider::text',
            request: {
              conversation: { id: 'topic', topicId: 'topic' },
              trigger: 'submit-message',
              messageId: message.id,
              messages: []
            }
          }
        ],
        listeners: [
          {
            id: 'count-policy-test',
            isAlive: () => true,
            onChunk() {},
            onPaused() {},
            onError() {},
            onDone(value) {
              result = value
            }
          }
        ]
      })
      await vi.waitFor(() => expect(result?.finalMessage).toBeDefined())
      expect(streamText.mock.calls[0][0]).toMatchObject({
        illustrationPolicy: { mode, count: 2 }
      })
      const illustrations = result?.finalMessage?.parts.filter((part) => part.type === 'data-illustration')
      expect(illustrations?.map((part) => part.data.prompt)).toEqual(['first', 'second'])
      expect(result?.finalMessage?.parts.at(-1)).toMatchObject({ type: 'text', text: '\nAfter' })
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    }
  )

  // Catches a single-model retry escaping its original multi-model group, or ordinary regeneration being excluded.
  it.each([
    { label: 'a new multi-model reply', modelCount: 2, previousModel: null, illustrates: false },
    { label: 'a retry within a multi-model group', modelCount: 1, previousModel: 'other', illustrates: false },
    { label: 'regeneration with the same model', modelCount: 1, previousModel: 'text', illustrates: true }
  ])('applies the ordinary-chat scope to $label', async ({ modelCount, previousModel, illustrates }) => {
    dbh.db.insert(userProviderTable).values({ providerId: 'provider', name: 'Provider', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values(
        ['text', 'other'].map((modelId, index) => ({
          id: createUniqueModelId('provider', modelId),
          providerId: 'provider',
          modelId,
          presetModelId: modelId,
          name: modelId,
          orderKey: `a${index}`
        }))
      )
      .run()
    const message = createReply(createUniqueModelId('provider', 'text'))
    const makeSibling = (model: string) =>
      messageService.create('topic', {
        parentId: message.parentId,
        siblingsGroupId: 1,
        modelId: createUniqueModelId('provider', model),
        role: 'assistant',
        data: { parts: [] },
        status: 'success'
      })
    if (previousModel) makeSibling(previousModel)
    const replies = [message, ...(modelCount === 2 ? [makeSibling('other')] : [])]
    const text = 'Before\n[[IMAGE]]bird[[/IMAGE]]\nAfter'
    const streamText = vi.fn(
      async (request: AiStreamRequest) =>
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            const chunks: UIMessageChunk[] = [
              { type: 'start', messageId: request.messageId },
              { type: 'text-start', id: 'text' },
              { type: 'text-delta', id: 'text', delta: text },
              { type: 'text-end', id: 'text' },
              { type: 'finish', finishReason: 'stop' }
            ]
            chunks.forEach((chunk) => controller.enqueue(chunk))
            controller.close()
          }
        })
    )
    MockApplicationUtils.setService('AiService', { streamText, generateImage: generate })
    const results: StreamDoneResult[] = []
    new AiStreamManager().send({
      topicId: 'topic',
      isPersistentConversation: true,
      models: replies.map((reply, index) => ({
        modelId: createUniqueModelId('provider', index === 0 ? 'text' : 'other'),
        request: {
          conversation: { id: 'topic', topicId: 'topic' },
          trigger: 'submit-message',
          messageId: reply.id,
          messages: []
        }
      })),
      listeners: [
        {
          id: 'scope-test',
          isAlive: () => true,
          onChunk() {},
          onPaused() {},
          onError() {},
          onDone(result) {
            results.push(result)
          }
        }
      ]
    })
    await vi.waitFor(() => expect(results).toHaveLength(modelCount))
    for (const result of results) {
      if (illustrates)
        expect(result.finalMessage?.parts.map((part) => part.type)).toEqual(['text', 'data-illustration', 'text'])
      else expect(result.finalMessage?.parts).toEqual([{ type: 'text', text, state: 'done' }])
    }
    if (illustrates) {
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
      finish({ files: [{ id: fileId, name: 'bird' }] })
      const part = results[0].finalMessage?.parts.find((part) => part.type === 'data-illustration')
      if (part?.type !== 'data-illustration') throw new Error('Expected illustration part')
      await vi.waitFor(() =>
        expect(service.get({ topicId: 'topic', messageId: message.id, id: part.data.id })?.status).toBe('ready')
      )
    } else expect(generate).not.toHaveBeenCalled()
  })

  // Catches the terminal text snapshot overwriting a faster image result.
  it('merges an early image result into the final message and protects its managed file', async () => {
    const { target, parts, backend } = seed()
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    finish({ files: [{ id: fileId, name: 'bird' }] })
    await vi.waitFor(() => expect(service.get(target)?.status).toBe('ready'))
    await backend.persistAssistant({
      finalMessage: { id: target.messageId, role: 'assistant', parts },
      status: 'success'
    })
    const stored = messageService.getById(target.messageId).data.parts
    expect(stored).toEqual([
      parts[0],
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ready', files: [{ id: fileId, name: 'bird' }] })
      }),
      parts[2]
    ])
    expect(dbh.db.select().from(chatMessageFileRefTable).all()).toEqual([
      expect.objectContaining({ sourceId: target.messageId, fileEntryId: fileId })
    ])
  })

  it('writes a late image result without losing newer text, and repeated reads never generate again', async () => {
    const { target, parts, backend } = seed()
    await backend.persistAssistant({
      finalMessage: { id: target.messageId, role: 'assistant', parts },
      status: 'success'
    })
    expect(messageService.getById(target.messageId).status).toBe('success')
    messageService.update(target.messageId, { data: { parts: [...parts, { type: 'text', text: 'newer edit' }] } })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    finish({ files: [{ id: fileId, name: 'bird' }] })
    await vi.waitFor(() => expect(service.get(target)?.status).toBe('ready'))
    expect(messageService.getById(target.messageId).data.parts?.at(-1)).toEqual({ type: 'text', text: 'newer edit' })
    for (let i = 0; i < 3; i++) expect(service.get(target)?.files?.[0].id).toBe(fileId)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('retains a failed answer and only retries on an explicit command', async () => {
    const { target, parts, backend } = seed()
    await backend.persistAssistant({
      finalMessage: { id: target.messageId, role: 'assistant', parts },
      status: 'error'
    })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    fail(new Error('provider unavailable'))
    await vi.waitFor(() => expect(service.get(target)).toMatchObject({ status: 'error', error: 'generation' }))
    expect(messageService.getById(target.messageId).data.parts?.[0]).toEqual(parts[0])
    expect(generate).toHaveBeenCalledTimes(1)
    service.retry(target)
    service.retry(target)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    finish({ files: [{ id: fileId, name: 'bird' }] })
    await vi.waitFor(() => expect(service.get(target)?.status).toBe('ready'))
  })

  it('cancels on stop and ignores a provider result that arrives after cancellation', async () => {
    const { target, parts, backend } = seed()
    await backend.persistAssistant({
      finalMessage: { id: target.messageId, role: 'assistant', parts },
      status: 'paused'
    })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    service.cancel(target)
    finish({ files: [{ id: fileId, name: 'bird' }] })
    await Promise.resolve()
    expect(service.get(target)?.status).toBe('cancelled')
    await application.get('PreferenceService').set('chat.illustration.mode', 'off')
    service.retry(target)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('updates temporary replies and follows their original identity into saved history', async () => {
    const topic = temporaryChatService.createTopic({ name: 'temporary' })
    const target = { topicId: topic.id, messageId: 'temp-answer', id: 'temp-image' }
    service.start(target, new AbortController().signal)
    const data = service.complete(target, 'a bird', true)
    const parts: CherryMessagePart[] = [{ type: 'data-illustration', id: target.id, data }]
    await new TemporaryChatBackend({ topicId: topic.id, messageId: target.messageId }).persistAssistant({
      finalMessage: { id: target.messageId, role: 'assistant', parts },
      status: 'success'
    })
    temporaryChatService.persist(topic.id)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    finish({ files: [{ id: fileId, name: 'bird' }] })
    await vi.waitFor(() => expect(service.get(target)?.status).toBe('ready'))
    expect(messageService.getById(target.messageId).data.parts?.[0]).toMatchObject({ data: { status: 'ready' } })
    expect(dbh.db.select().from(chatMessageFileRefTable).all()).toEqual([
      expect.objectContaining({ sourceId: target.messageId, fileEntryId: fileId })
    ])
  })
})
