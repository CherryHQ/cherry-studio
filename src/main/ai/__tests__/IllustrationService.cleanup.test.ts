import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { topicTable } from '@main/data/db/schemas/topic'
import { fileEntryService } from '@main/data/services/FileEntryService'
import { fileRefService } from '@main/data/services/FileRefService'
import { messageService } from '@main/data/services/MessageService'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { FileManager } from '@main/services/file'
import type { CleanupPolicy } from '@shared/data/types/file'

import { IllustrationService } from '../IllustrationService'
import type { IllustrationInput } from '../messages/illustrationInputs'
import { TemporaryChatBackend } from '../streamManager/persistence/backends/TemporaryChatBackend'
import { resolveConfiguredPaintingModel } from '../tools/painting'

vi.mock('../tools/painting', () => ({
  resolveConfiguredPaintingModel: vi.fn(),
  extractParamValues: () => ({})
}))
vi.mock('@main/data/db/restore/restoreJournal', () => ({ hasPendingRestore: () => false }))

describe('temporary illustration file ownership', () => {
  const dbh = setupTestDatabase()
  let root: string
  let files: FileManager
  let service: IllustrationService
  let topicId: string
  let finishImage: () => void
  let imageSignal: AbortSignal | undefined
  let generatedFileId: string | undefined

  beforeEach(async () => {
    BaseService.resetInstances()
    root = await mkdtemp(path.join(tmpdir(), 'illustration-cleanup-'))
    vi.mocked(application.getPath).mockImplementation((_key, filename) => (filename ? path.join(root, filename) : root))
    files = new FileManager()
    service = new IllustrationService()
    MockApplicationUtils.setService('FileManager', files)
    MockApplicationUtils.setService('IllustrationService', service)
    imageSignal = undefined
    generatedFileId = undefined
    MockApplicationUtils.setService('AiService', {
      async generateImage({
        cleanupPolicy,
        requestOptions
      }: {
        cleanupPolicy: CleanupPolicy
        requestOptions: { signal: AbortSignal }
      }) {
        imageSignal = requestOptions.signal
        await new Promise<void>((resolve) => {
          finishImage = resolve
        })
        const entry = await files.createInternalEntry({
          source: 'bytes',
          data: new Uint8Array([1, 2, 3]),
          name: 'bird',
          ext: 'png',
          cleanupPolicy
        })
        generatedFileId = entry.id
        return { files: [entry] }
      }
    })
    vi.mocked(resolveConfiguredPaintingModel).mockReturnValue({ uniqueModelId: 'provider::image', support: null })
    await service._doInit()
    topicId = temporaryChatService.createTopic({ name: 'temporary' }).id
  })

  afterEach(async () => {
    if (temporaryChatService.hasTopic(topicId)) temporaryChatService.deleteTopic(topicId)
    await service._doStop()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  function startReply(prompt = 'a bird', inputs: readonly IllustrationInput[] = []) {
    const target = { topicId, messageId: '019606a0-0000-7000-8000-00000000fd01', id: 'temporary-image' }
    service.start(target, new AbortController().signal)
    const data = service.complete(target, prompt, true, inputs)
    const persistReply = () =>
      new TemporaryChatBackend({ topicId, messageId: target.messageId }).persistAssistant({
        finalMessage: {
          id: target.messageId,
          role: 'assistant',
          parts: [{ type: 'data-illustration', id: target.id, data }]
        },
        status: 'success'
      })
    return { target, persistReply }
  }

  async function completedFile(target: ReturnType<typeof startReply>['target']) {
    await vi.waitFor(() => expect(service.get(target)?.status).toBe('ready'))
    return cleanupCandidate(service.get(target)!.files![0].id)
  }

  function cleanupCandidate(id: string) {
    dbh.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 7_200_000 })
      .where(eq(fileEntryTable.id, id))
      .run()
    return { id, physicalPath: files.getPhysicalPath(id) }
  }

  it.each(['before', 'after'] as const)(
    'keeps an image completed %s the text finalizes and reclaims it after the temporary chat closes',
    async (timing) => {
      const { target, persistReply } = startReply()
      if (timing === 'after') await persistReply()
      finishImage()
      const entry = await completedFile(target)
      if (timing === 'before') {
        await files.runEntryCleanup()
        expect(fileEntryService.findById(entry.id)).not.toBeNull()
        await persistReply()
      }

      await files.runEntryCleanup()
      expect(fileEntryService.findById(entry.id)).not.toBeNull()
      await expect(access(entry.physicalPath)).resolves.toBeUndefined()

      temporaryChatService.deleteTopic(topicId)
      await files.runEntryCleanup()
      expect(fileEntryService.findById(entry.id)).toBeNull()
      await expect(access(entry.physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('reclaims an image discarded before the reply reaches terminal persistence', async () => {
    const { target, persistReply } = startReply()
    finishImage()
    const entry = await completedFile(target)

    temporaryChatService.deleteTopic(topicId)
    await expect(persistReply()).rejects.toThrow(/not found/i)
    await files.runEntryCleanup()

    expect(fileEntryService.findById(entry.id)).toBeNull()
    await expect(access(entry.physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(service.get(target)).toBeNull()
    expect(service.retry(target)).toBeNull()
  })

  it('aborts discarded work, releases its inputs, and reclaims output returned despite cancellation', async () => {
    const input = await files.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([4, 5, 6]),
      name: 'input',
      ext: 'png',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    const original = cleanupCandidate(input.id)
    vi.mocked(resolveConfiguredPaintingModel).mockReturnValue({
      uniqueModelId: 'provider::image',
      support: null,
      acceptsImageInput: true
    })
    const { target, persistReply } = startReply('references: ["image_1"]\na bird', [
      { reference: 'image_1', id: input.id, name: input.name }
    ])
    await vi.waitFor(() => expect(imageSignal).toBeDefined())
    await files.runEntryCleanup()
    expect(fileEntryService.findById(input.id)).not.toBeNull()

    temporaryChatService.deleteTopic(topicId)
    expect(imageSignal?.aborted).toBe(true)
    await files.runEntryCleanup()
    expect(fileEntryService.findById(input.id)).toBeNull()
    await expect(access(original.physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })

    finishImage()
    await vi.waitFor(() => expect(generatedFileId).toBeDefined())
    const output = cleanupCandidate(generatedFileId!)
    await expect(persistReply()).rejects.toThrow(/not found/i)
    await files.runEntryCleanup()
    expect(fileEntryService.findById(output.id)).toBeNull()
    await expect(access(output.physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(service.get(target)).toBeNull()
    expect(service.retry(target)).toBeNull()
  })

  it('keeps completed output after a retryable terminal write failure until append succeeds', async () => {
    const { target, persistReply } = startReply()
    finishImage()
    const entry = await completedFile(target)
    vi.spyOn(temporaryChatService, 'appendAssistantMessage').mockImplementationOnce(() => {
      throw new Error('retryable save failure')
    })

    await expect(persistReply()).rejects.toThrow('retryable save failure')
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    await expect(access(entry.physicalPath)).resolves.toBeUndefined()
    expect(service.get(target)?.status).toBe('ready')

    await persistReply()
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()

    temporaryChatService.deleteTopic(topicId)
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).toBeNull()
    await expect(access(entry.physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains images after a failed save and hands ownership to saved message references after retry', async () => {
    const { target, persistReply } = startReply()
    await persistReply()
    finishImage()
    const entry = await completedFile(target)
    dbh.db.insert(topicTable).values({ id: topicId, orderKey: 'collision' }).run()

    expect(() => temporaryChatService.persist(topicId)).toThrow()
    expect(temporaryChatService.hasTopic(topicId)).toBe(true)
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()

    dbh.db.delete(topicTable).where(eq(topicTable.id, topicId)).run()
    temporaryChatService.persist(topicId)
    expect(temporaryChatService.hasTopic(topicId)).toBe(false)
    expect(fileRefService.findByEntryId(entry.id).map((ref) => ref.sourceId)).toEqual([target.messageId])
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()

    messageService.delete(target.messageId)
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).toBeNull()
    await expect(access(entry.physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('attaches late output to promoted history without retaining it after the saved message is deleted', async () => {
    const { target, persistReply } = startReply()
    await persistReply()
    temporaryChatService.persist(topicId)
    finishImage()
    const entry = await completedFile(target)

    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    expect(messageService.getById(target.messageId).data.parts?.[0]).toMatchObject({ data: { status: 'ready' } })

    messageService.delete(target.messageId)
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).toBeNull()
    await expect(access(entry.physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
