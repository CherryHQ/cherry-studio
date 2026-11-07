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
import { fileRefService } from '@main/data/services/FileRefService'
import { messageService } from '@main/data/services/MessageService'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'

import { IllustrationService } from '../IllustrationService'
import { AiStreamManager } from '../streamManager/AiStreamManager'
import { MessageServiceBackend } from '../streamManager/persistence/backends/MessageServiceBackend'
import { TemporaryChatBackend } from '../streamManager/persistence/backends/TemporaryChatBackend'
import type { AiStreamSource, StreamDoneResult, StreamListener } from '../streamManager/types'
import { resolveConfiguredPaintingModel } from '../tools/painting'
import type { AiStreamRequest } from '../types/requests'

vi.mock('../tools/painting', () => ({
  resolveConfiguredPaintingModel: vi.fn(),
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
    vi.mocked(resolveConfiguredPaintingModel).mockReturnValue({ uniqueModelId: 'provider::image', support: null })
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

  // Catches dropping selected originals, reordering them, or requiring Seedream to expose an edit mode.
  it('uploads only the selected user images in their requested order with a clean prompt', async () => {
    const message = createReply()
    const target = { topicId: 'topic', messageId: message.id, id: 'selected-images' }
    vi.mocked(resolveConfiguredPaintingModel).mockReturnValue({
      uniqueModelId: 'provider::seedream',
      acceptsImageInput: true,
      support: { modes: { generate: { supports: {}, maxInputImages: 2 } } }
    })
    MockApplicationUtils.setService('FileManager', {
      read: vi.fn(async (id: string) => ({ content: id === fileId ? 'AQID' : 'BAUG', mime: 'image/png' }))
    })
    service.start(target, new AbortController().signal)
    service.complete(target, 'references: ["image_2", "image_1", "image_2"]\nCombine the person and scene.', true, [
      { reference: 'image_1', id: fileId, name: 'person.png' },
      { reference: 'image_2', id: 'scene', name: 'scene.png' },
      { reference: 'image_3', id: 'unused', name: 'unused.png' }
    ])

    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    expect(generate.mock.calls[0][0]).toMatchObject({
      uniqueModelId: 'provider::seedream',
      mode: 'generate',
      prompt: 'Combine the person and scene.',
      inputImages: ['data:image/png;base64,BAUG', 'data:image/png;base64,AQID']
    })
    expect(service.get(target)?.inputFiles).toEqual([
      { id: 'scene', name: 'scene.png' },
      { id: fileId, name: 'person.png' }
    ])
    finish({ files: [{ id: fileId, name: 'combined' }] })
    await vi.waitFor(() => expect(service.get(target)?.status).toBe('ready'))
  })

  // Catches sending a paid text-only request after rejecting or losing an explicitly selected original.
  it.each([
    { label: 'unknown reference', header: '["image_99"]', error: 'invalid_references' },
    { label: 'malformed reference list', header: 'image_1', error: 'invalid_references' },
    { label: 'non-string reference', header: '[1]', error: 'invalid_references' },
    { label: 'too many images', header: '["image_1", "image_2"]', error: 'input_limit' },
    { label: 'unsupported model', header: '["image_1"]', error: 'input_unsupported' },
    { label: 'missing image', header: '["image_1"]', error: 'input_unavailable' },
    { label: 'non-image file', header: '["image_1"]', error: 'input_unavailable' }
  ] as const)('fails the illustration for $label without submitting generation', async ({ label, header, error }) => {
    const message = createReply()
    const target = { topicId: 'topic', messageId: message.id, id: 'invalid-selection' }
    vi.mocked(resolveConfiguredPaintingModel).mockReturnValue({
      uniqueModelId: 'provider::image',
      acceptsImageInput: label !== 'unsupported model',
      support: { modes: { edit: { supports: {}, maxInputImages: 1 } } }
    })
    MockApplicationUtils.setService('FileManager', {
      read: vi.fn(async () => {
        if (label === 'missing image') throw new Error('Missing file')
        return { content: 'AQID', mime: label === 'non-image file' ? 'text/plain' : 'image/png' }
      })
    })
    service.start(target, new AbortController().signal)
    service.complete(target, `references: ${header}\nEdit the photo.`, true, [
      { reference: 'image_1', id: fileId, name: 'person.png' },
      { reference: 'image_2', id: 'scene', name: 'scene.png' }
    ])
    await vi.waitFor(() => expect(service.get(target)).toMatchObject({ status: 'error', error }))
    expect(generate).not.toHaveBeenCalled()
    if (error === 'invalid_references') {
      service.retry(target)
      expect(service.get(target)?.error).toBe('invalid_references')
      expect(generate).not.toHaveBeenCalled()
    }
  })

  // Catches reparsing a saved prompt or losing the original when its upload message is deleted.
  it('retains selected files with the answer and retries the same selection after restart using the current model', async () => {
    const message = createReply()
    const original = messageService.create('topic', {
      parentId: message.parentId,
      role: 'user',
      status: 'success',
      data: {
        parts: [
          { type: 'file', mediaType: 'image/png', url: '', providerMetadata: { cherry: { fileEntryId: fileId } } }
        ]
      }
    })
    const target = { topicId: 'topic', messageId: message.id, id: 'durable-selection' }
    vi.mocked(resolveConfiguredPaintingModel).mockReturnValue({
      uniqueModelId: 'provider::old',
      acceptsImageInput: true,
      support: { modes: { edit: { supports: {} } } }
    })
    const read = vi.fn(async () => ({ content: 'AQID', mime: 'image/png' }))
    MockApplicationUtils.setService('FileManager', { read })
    service.start(target, new AbortController().signal)
    const data = service.complete(target, 'references: ["image_1"]\nMake the sky blue.', true, [
      { reference: 'image_1', id: fileId, name: 'original.png' }
    ])
    await new MessageServiceBackend({ assistantMessageId: message.id }).persistAssistant({
      finalMessage: { id: message.id, role: 'assistant', parts: [{ type: 'data-illustration', id: target.id, data }] },
      status: 'success'
    })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    fail(new Error('provider unavailable'))
    await vi.waitFor(() => expect(service.get(target)?.status).toBe('error'))
    messageService.delete(original.id)
    expect(fileRefService.findByEntryId(fileId).map((ref) => ref.sourceId)).toEqual([message.id])

    BaseService.resetInstances()
    service = new IllustrationService()
    MockApplicationUtils.setService('IllustrationService', service)
    vi.mocked(resolveConfiguredPaintingModel).mockReturnValue({
      uniqueModelId: 'provider::new',
      acceptsImageInput: true,
      support: { modes: { generate: { supports: {}, maxInputImages: 1 } } }
    })
    service.retry(target)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    expect(generate.mock.calls[1][0]).toMatchObject({
      uniqueModelId: 'provider::new',
      mode: 'generate',
      prompt: 'Make the sky blue.',
      inputImages: ['data:image/png;base64,AQID']
    })
    fail(new Error('provider unavailable'))
    await vi.waitFor(() => expect(service.get(target)?.status).toBe('error'))
    read.mockRejectedValueOnce(new Error('Original deleted from disk'))
    service.retry(target)
    await vi.waitFor(() => expect(service.get(target)?.error).toBe('input_unavailable'))
    expect(generate).toHaveBeenCalledTimes(2)
    messageService.delete(message.id)
    expect(fileRefService.findByEntryId(fileId)).toEqual([])
  })

  // Catches mode lookup before stream registration silently disabling every fresh reply.
  it('streams later text and persists the reserved position before a delayed illustration finishes', async () => {
    const message = createReply()
    const backend = new MessageServiceBackend({ assistantMessageId: message.id })
    let upstream!: ReadableStreamDefaultController<UIMessageChunk>
    const streamText = vi.fn(
      async (): Promise<AiStreamSource> => ({
        kind: 'chunks',
        stream: new ReadableStream<UIMessageChunk>({
          start(controller) {
            upstream = controller
          }
        })
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
      const streamText = vi.fn(async (request: AiStreamRequest): Promise<AiStreamSource> => {
        await application.get('PreferenceService').setMultiple({
          'chat.illustration.mode': 'off',
          'chat.illustration.max_count': 9,
          'chat.illustration.target_count': 9
        })
        const stream = new ReadableStream<UIMessageChunk>({
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
        return { kind: 'chunks', stream }
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
      async (request: AiStreamRequest): Promise<AiStreamSource> => ({
        kind: 'chunks',
        stream: new ReadableStream<UIMessageChunk>({
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

  it.each(['error', 'cancelled'] as const)('cancels a retry after %s when the original reply stops', async (status) => {
    const message = createReply()
    const target = { topicId: 'topic', messageId: message.id, id: 'retried-image' }
    const reply = new AbortController()
    service.start(target, reply.signal)
    service.complete(target, 'a bird', true)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    if (status === 'error') fail(new Error('provider unavailable'))
    else {
      service.cancel(target)
      finish({ files: [] })
    }
    await vi.waitFor(() => expect(service.get(target)?.status).toBe(status))

    service.retry(target)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    const signal: AbortSignal = generate.mock.calls[1][0].requestOptions.signal
    reply.abort()

    expect(signal.aborted).toBe(true)
    expect(service.get(target)?.status).toBe('cancelled')
    finish({ files: [{ id: fileId, name: 'late result' }] })
    await Promise.resolve()
    expect(service.get(target)).toMatchObject({ status: 'cancelled', files: undefined })
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
