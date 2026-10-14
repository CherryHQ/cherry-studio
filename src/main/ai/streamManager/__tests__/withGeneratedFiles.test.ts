import '@data/services/MessageService'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { type FileUIPart, streamText, type UIMessageChunk } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { Document, Packer, Paragraph } from 'docx'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { topicService } from '@data/services/TopicService'
import { TemporaryChatService } from '@main/ai/TemporaryChatService'
import { BaseService } from '@main/core/lifecycle'
import * as fileUtils from '@main/utils/file'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { tryFileUrlToPath } from '@shared/utils/file'

import { collectFileAttachments, prepareChatMessages } from '../../messages/attachmentRouting'
import { materializeNativeFilePart } from '../../messages/fileProcessor'
import { readFile as readAttachedFile } from '../../tools/adapters/aiSdk/builtin/ReadFileTool'
import { temporaryChatContextProvider } from '../context/TemporaryChatContextProvider'
import { pipeStreamLoop } from '../pipeStreamLoop'
import { withGeneratedFiles } from '../withGeneratedFiles'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileManager } = await import('@main/services/file/FileManager')
const VIDEO = Buffer.from('generated video bytes')
const DATA_URL = `data:video/mp4;base64,${VIDEO.toString('base64')}`

describe('generated conversation attachments', () => {
  const dbh = setupTestDatabase()
  let temporary: TemporaryChatService
  let directory: string
  let manager: InstanceType<typeof FileManager>

  beforeEach(async () => {
    MockMainCacheServiceUtils.resetMocks()
    directory = await mkdtemp(path.join(tmpdir(), 'cherry-generated-file-'))
    await mkdir(path.join(directory, 'files'))
    await mkdir(path.join(directory, 'app.temp'))
    vi.mocked(application.getPath).mockImplementation((_key: string, filename?: string) =>
      path.join(directory, _key === 'feature.files.data' ? 'files' : _key, filename ?? '')
    )
    BaseService.resetInstances()
    manager = new FileManager()
    temporary = new TemporaryChatService()
    const container = application.getContainer()
    vi.mocked(application.get).mockImplementation((name: string) =>
      name === 'FileManager' ? manager : name === 'TemporaryChatService' ? temporary : container.get(name)
    )
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('stores SDK video output before broadcasting and replays its bytes in later turns', async () => {
    const result = streamText({
      model: new MockLanguageModelV3({
        doStream: async () => ({
          stream: convertArrayToReadableStream([
            {
              type: 'file',
              mediaType: 'video/mp4',
              data: VIDEO.toString('base64'),
              providerMetadata: { google: { interactionId: 'generated-1' } }
            },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 0, reasoning: 0 }
              }
            }
          ])
        })
      }),
      prompt: 'Generate a video.'
    })
    const chunks: UIMessageChunk[] = []
    const output = await pipeStreamLoop(withGeneratedFiles(result.toUIMessageStream()), new AbortController().signal, {
      onChunk: (chunk) => chunks.push(chunk)
    })
    expect(output.threw).toBeUndefined()
    expect(output.accumulationError).toBeUndefined()
    const part = output.finalMessage!.parts.find((part) => part.type === 'file')!
    const entryId = readCherryMeta(part)?.fileEntryId
    expect(entryId).toBeTruthy()
    expect(chunks.find((chunk) => chunk.type === 'file')).toMatchObject(part)
    expect(part).toMatchObject({
      url: manager.getUrl(entryId!),
      providerMetadata: { google: { interactionId: 'generated-1' }, cherry: { fileEntryId: entryId } }
    })
    expect(await manager.getById(entryId!)).toMatchObject({ ext: 'mp4', cleanupPolicy: 'delete_when_unreferenced' })
    expect((await manager.read(entryId!, { encoding: 'binary' })).content).toEqual(new Uint8Array(VIDEO))
    expect(await materializeNativeFilePart(part)).toMatchObject({ url: DATA_URL, mediaType: 'video/mp4' })
  })

  it.each([true, false])('routes local WebM by disk MIME with native video support = %s', async (video) => {
    const topic = temporary.createTopic({})
    const part = await temporary.storeGeneratedFile(topic.id, {
      type: 'file',
      mediaType: 'video/webm',
      url: 'data:video/webm;base64,' + VIDEO.toString('base64')
    })
    const messages = [{ id: 'webm', role: 'user' as const, parts: [part] }]
    const [prepared] = await prepareChatMessages(messages, {
      attachments: collectFileAttachments(messages),
      nativeSupport: { image: false, audio: false, video, pdf: false },
      isToolCapable: false
    })
    if (video) {
      expect(prepared.parts).toEqual([
        expect.objectContaining({
          type: 'file',
          mediaType: 'video/webm',
          url: 'data:video/webm;base64,' + VIDEO.toString('base64')
        })
      ])
    } else {
      expect(prepared.parts).toEqual([
        { type: 'text', text: `Attached file "file":\nThis model can't process the attached video file "file".` }
      ])
    }
  })

  describe('temporary dispatch admission', () => {
    beforeEach(() => {
      dbh.db.insert(userProviderTable).values({ providerId: 'attachment-test', name: 'Test', orderKey: 'a0' }).run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: 'attachment-test::model',
          providerId: 'attachment-test',
          modelId: 'model',
          name: 'Test model',
          capabilities: [],
          supportsStreaming: true,
          orderKey: 'a0'
        })
        .run()
    })

    function submit(topicId: string, part: FileUIPart) {
      return temporaryChatContextProvider.prepareDispatch(
        {
          id: 'test',
          onChunk: () => {},
          onDone: () => {},
          onPaused: () => {},
          onError: () => {},
          isAlive: () => true
        },
        {
          topicId,
          trigger: 'submit-message',
          mentionedModelIds: ['attachment-test::model'],
          userMessageParts: [part]
        },
        { hasLiveStream: false }
      )
    }

    async function attachment() {
      const entry = await manager.createInternalEntry({
        source: 'bytes',
        data: VIDEO,
        name: 'input',
        ext: 'mp4',
        cleanupPolicy: 'delete_when_unreferenced'
      })
      return {
        type: 'file' as const,
        mediaType: 'video/mp4',
        url: manager.getUrl(entry.id),
        providerMetadata: { cherry: { fileEntryId: entry.id } }
      }
    }

    it('keeps an admitted dispatch exclusive with promotion during the attachment copy', async () => {
      const part = await attachment()
      const topic = temporary.createTopic({})
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const copy = fileUtils.copy
      vi.spyOn(fileUtils, 'copy').mockImplementationOnce(async (...args) => {
        started.resolve()
        await release.promise
        return copy(...args)
      })
      const dispatch = submit(topic.id, part)
      await started.promise
      const outcomes = Promise.allSettled([dispatch, temporary.persist(topic.id)])
      release.resolve()
      const [prepared, saved] = await outcomes
      expect(prepared.status).toBe('fulfilled')
      expect(saved).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ message: expect.stringContaining('turn is active') })
      })
      expect(temporary.listMessages(topic.id)).toHaveLength(1)
      expect(dbh.db.select().from(topicTable).all()).toHaveLength(0)
      temporary.finishTurn(topic.id)
      await expect(temporary.persist(topic.id)).resolves.toEqual({ topicId: topic.id, messageCount: 1 })
    })

    it('rejects another dispatch before it appends a user message during the first copy', async () => {
      const part = await attachment()
      const topic = temporary.createTopic({})
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const copy = fileUtils.copy
      vi.spyOn(fileUtils, 'copy').mockImplementationOnce(async (...args) => {
        started.resolve()
        await release.promise
        return copy(...args)
      })
      const first = submit(topic.id, part)
      await started.promise
      const second = submit(topic.id, part)
      const outcomes = Promise.allSettled([first, second])
      release.resolve()
      const results = await outcomes
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
      expect(temporary.listMessages(topic.id)).toHaveLength(1)
      temporary.finishTurn(topic.id)
    })

    it('releases admission after a failed copy so a retry can run and later be saved', async () => {
      const part = await attachment()
      const topic = temporary.createTopic({})
      vi.spyOn(fileUtils, 'copy').mockRejectedValueOnce(new Error('copy failed'))
      await expect(submit(topic.id, part)).rejects.toThrow('copy failed')
      expect(temporary.listMessages(topic.id)).toHaveLength(0)
      const prepared = await submit(topic.id, part)
      expect(prepared.models[0].abortController?.signal.aborted).toBe(false)
      expect(temporary.listMessages(topic.id)).toHaveLength(1)
      temporary.finishTurn(topic.id)
      await expect(temporary.persist(topic.id)).resolves.toEqual({ topicId: topic.id, messageCount: 1 })
    })
  })

  it('surfaces storage failures while preserving content received before the file', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start', messageId: 'failed-video' },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Video result:' },
      { type: 'text-end', id: 'text' },
      { type: 'file', mediaType: 'video/mp4', url: 'data:video/mp4;base64,' },
      { type: 'finish' }
    ]
    const output = await pipeStreamLoop(
      withGeneratedFiles(convertArrayToReadableStream(chunks)),
      new AbortController().signal,
      { onChunk: () => {} }
    )
    expect(output.threw?.error).toBeInstanceOf(Error)
    expect(output.finalMessage?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'Video result:' }))
    expect(output.finalMessage?.parts.some((part) => part.type === 'file')).toBe(false)
  })

  it('keeps existing handles, remote URLs and inline image rendering unchanged', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start', messageId: 'existing' },
      {
        type: 'file',
        mediaType: 'video/mp4',
        url: 'file:///video.mp4',
        providerMetadata: { cherry: { fileEntryId: 'existing-entry' } }
      },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,aW1hZ2U=' },
      { type: 'file', mediaType: 'video/mp4', url: 'https://example.com/video.mp4' },
      { type: 'finish' }
    ]
    const emitted: UIMessageChunk[] = []
    await pipeStreamLoop(withGeneratedFiles(convertArrayToReadableStream(chunks)), new AbortController().signal, {
      onChunk: (chunk) => emitted.push(chunk)
    })
    expect(emitted).toEqual(chunks)
  })
  it.each(['https://example.com/download?id=123', 'http://127.0.0.1/private', 'http://169.254.169.254/metadata'])(
    'preserves remote video MIME through history without fetching %s',
    async (url) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected remote download'))
      const part: FileUIPart = { type: 'file', mediaType: 'video/mp4', url }
      const output = await pipeStreamLoop(
        withGeneratedFiles(
          convertArrayToReadableStream([{ type: 'start', messageId: 'remote-video' }, part, { type: 'finish' }])
        ),
        new AbortController().signal,
        { onChunk: () => {} }
      )
      expect(output.threw).toBeUndefined()
      const history = [output.finalMessage!]
      const prepared = await prepareChatMessages(history, {
        attachments: collectFileAttachments(history),
        nativeSupport: { image: true, pdf: true, audio: true, video: true },
        isToolCapable: false
      })
      expect(prepared[0].parts).toContainEqual(part)
      expect(fetch).not.toHaveBeenCalled()
      expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(0)
    }
  )

  it('keeps temporary output readable through cleanup and atomically references it when saved', async () => {
    const topic = temporary.createTopic({})
    const emitted: UIMessageChunk[] = []
    const output = await pipeStreamLoop(
      withGeneratedFiles(
        convertArrayToReadableStream([
          { type: 'start', messageId: 'temp-video' },
          { type: 'file', mediaType: 'video/mp4', url: DATA_URL },
          { type: 'finish' }
        ]),
        (part) => temporary.storeGeneratedFile(topic.id, part)
      ),
      new AbortController().signal,
      { onChunk: (chunk) => emitted.push(chunk) }
    )
    const part = output.finalMessage!.parts.find((part) => part.type === 'file')!
    expect(readCherryMeta(part)?.fileEntryId).toBeUndefined()
    expect(emitted.find((chunk) => chunk.type === 'file')).toMatchObject(part)
    expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(0)
    const message = await temporary.appendMessage(topic.id, { role: 'assistant', data: { parts: [part] } })
    const oldTime = Date.now() - 2 * 60 * 60 * 1000
    expect((await manager.runEntryCleanup()).deleted).toBe(0)
    expect(await materializeNativeFilePart(part)).toMatchObject({ url: DATA_URL })
    await temporary.persist(topic.id)
    const saved = dbh.db.select().from(messageTable).where(eq(messageTable.id, message.id)).get()!
    const savedPart = saved.data.parts![0]
    if (savedPart.type !== 'file') throw new Error('Expected saved attachment')
    const entryId = readCherryMeta(savedPart)?.fileEntryId!
    expect(dbh.db.select().from(chatMessageFileRefTable).all()).toMatchObject([
      { sourceId: message.id, fileEntryId: entryId, role: 'attachment' }
    ])
    dbh.db.update(fileEntryTable).set({ createdAt: oldTime }).run()
    expect((await manager.runEntryCleanup()).deleted).toBe(0)
    expect((await manager.read(entryId, { encoding: 'binary' })).content).toEqual(new Uint8Array(VIDEO))
    expect(await materializeNativeFilePart(savedPart)).toMatchObject({ url: DATA_URL })
    await expect(access(tryFileUrlToPath(part.url)!)).rejects.toThrow()
  })

  it('copies an existing managed attachment so deleting its original owner cannot break temporary history', async () => {
    const original = await manager.createInternalEntry({
      source: 'bytes',
      data: VIDEO,
      name: 'input',
      ext: 'mp4',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    const topic = temporary.createTopic({})
    const message = await temporary.appendMessage(topic.id, {
      role: 'user',
      data: {
        parts: [
          {
            type: 'file',
            mediaType: 'video/mp4',
            url: manager.getUrl(original.id),
            providerMetadata: { cherry: { fileEntryId: original.id } }
          }
        ]
      }
    })
    dbh.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 2 * 60 * 60 * 1000 })
      .run()
    expect((await manager.runEntryCleanup()).deleted).toBe(1)
    const part = message.data.parts![0]
    if (part.type !== 'file') throw new Error('Expected temporary attachment')
    expect(readCherryMeta(part)?.fileEntryId).toBeUndefined()
    expect(await materializeNativeFilePart(part)).toMatchObject({ url: DATA_URL })
    await temporary.deleteTopic(topic.id)
    await expect(access(tryFileUrlToPath(part.url)!)).rejects.toThrow()
  })

  it.each(['png', 'txt', 'docx'])('processes a temporary %s copy after its original entry is deleted', async (ext) => {
    const text = 'Independent attachment text. '.repeat(1000).trim()
    const bytes =
      ext === 'docx'
        ? await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }))
        : Buffer.from(text)
    const original = await manager.createInternalEntry({
      source: 'bytes',
      data: bytes,
      name: 'input',
      ext,
      cleanupPolicy: 'delete_when_unreferenced'
    })
    const topic = temporary.createTopic({})
    const message = await temporary.appendMessage(topic.id, {
      role: 'user',
      data: {
        parts: [
          {
            type: 'file',
            filename: 'input.' + ext,
            mediaType: ext === 'png' ? 'image/png' : 'application/octet-stream',
            url: manager.getUrl(original.id),
            providerMetadata: { cherry: { fileEntryId: original.id } }
          }
        ]
      }
    })
    await manager.permanentDelete(original.id)
    const ocr = vi.fn(async (file: { kind: string; path?: string }) => {
      if (file.kind !== 'path' || !file.path) throw new Error('OCR must read the independent copy')
      return readFile(file.path, 'utf8')
    })
    const getService = vi.mocked(application.get).getMockImplementation()!
    vi.mocked(application.get).mockImplementation(((name: string) =>
      name === 'FileProcessingService' ? { ocrImage: ocr } : getService(name as never)) as typeof application.get)
    const messages = [{ id: message.id, role: 'user' as const, parts: message.data.parts! }]
    const attachments = collectFileAttachments(messages)
    const [prepared] = await prepareChatMessages(messages, {
      attachments,
      nativeSupport: { image: false, pdf: false, audio: false, video: false },
      isToolCapable: true,
      budget: { tokens: 100, tokenizer: { id: 'chars', count: (s) => s.length } }
    })
    expect(prepared.parts).toContainEqual({ type: 'text', text: expect.stringContaining(text.slice(0, 80)) })
    expect(prepared.parts).toContainEqual({
      type: 'text',
      text: expect.stringContaining('read_file("input.' + ext + '"')
    })
    expect(await readAttachedFile({ filename: 'input.' + ext, offset: 100, limit: 200 }, { attachments })).toEqual({
      text: text.trim().slice(100, 300),
      totalChars: text.trim().length,
      nextOffset: 300
    })
    expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(0)
  })

  it('retains temporary bytes on failed promotion and reclaims failed permanent copies before retry', async () => {
    const topic = temporary.createTopic({})
    const message = await temporary.appendMessage(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'file', mediaType: 'video/mp4', url: DATA_URL }] }
    })
    const part = message.data.parts![0] as FileUIPart
    vi.spyOn(topicService, 'importConversation').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(temporary.persist(topic.id)).rejects.toThrow('database unavailable')
    expect(temporary.hasTopic(topic.id)).toBe(true)
    expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(topicTable).all()).toHaveLength(0)
    expect(await readFile(tryFileUrlToPath(part.url)!)).toEqual(VIDEO)
    await temporary.persist(topic.id)
    expect(temporary.hasTopic(topic.id)).toBe(false)
    expect(dbh.db.select().from(chatMessageFileRefTable).all()).toHaveLength(1)
  })

  it('rejects promotion during an active turn and aborts that turn when the topic is discarded', async () => {
    const topic = temporary.createTopic({})
    const controller = temporary.beginTurn(topic.id)
    await expect(temporary.persist(topic.id)).rejects.toThrow('turn is active')
    await temporary.deleteTopic(topic.id)
    expect(controller.signal.aborted).toBe(true)
    await expect(
      temporary.storeGeneratedFile(topic.id, { type: 'file', mediaType: 'video/mp4', url: DATA_URL })
    ).rejects.toThrow()
    expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(0)
  })

  it('waits for an in-flight attachment write before deleting its temporary directory', async () => {
    const topic = temporary.createTopic({})
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const originalWrite = fileUtils.write
    vi.spyOn(fileUtils, 'write').mockImplementationOnce(async (...args) => {
      started.resolve()
      await release.promise
      return originalWrite(...args)
    })
    const writing = temporary.storeGeneratedFile(topic.id, { type: 'file', mediaType: 'video/mp4', url: DATA_URL })
    await started.promise
    const deleting = temporary.deleteTopic(topic.id)
    await expect(
      temporary.storeGeneratedFile(topic.id, { type: 'file', mediaType: 'video/mp4', url: DATA_URL })
    ).rejects.toThrow()
    release.resolve()
    const part = await writing
    await deleting
    await expect(access(tryFileUrlToPath(part.url)!)).rejects.toThrow()
    expect(temporary.hasTopic(topic.id)).toBe(false)
  })

  it('lets an admitted promotion finish before shutdown removes temporary files', async () => {
    const topic = temporary.createTopic({})
    const message = await temporary.appendMessage(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'file', mediaType: 'video/mp4', url: DATA_URL }] }
    })
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const create = manager.createInternalEntry.bind(manager)
    vi.spyOn(manager, 'createInternalEntry').mockImplementationOnce(async (input) => {
      started.resolve()
      await release.promise
      return create(input)
    })
    const saving = temporary.persist(topic.id)
    await started.promise
    const stopping = temporary._doStop()
    expect(() => temporary.createTopic({})).toThrow('stopping')
    release.resolve()
    await saving
    await stopping
    const saved = dbh.db.select().from(messageTable).where(eq(messageTable.id, message.id)).get()!
    const part = saved.data.parts![0]
    if (part.type !== 'file') throw new Error('Expected saved attachment')
    expect(await materializeNativeFilePart(part)).toMatchObject({ url: DATA_URL })
    expect(dbh.db.select().from(chatMessageFileRefTable).all()).toHaveLength(1)
    await expect(access(application.getPath('feature.temporary_chat.temp'))).rejects.toThrow()
  })
})
