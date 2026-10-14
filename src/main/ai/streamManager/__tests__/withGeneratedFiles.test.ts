import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { streamText, type UIMessageChunk } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { materializeNativeFilePart } from '../../messages/fileProcessor'
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
  setupTestDatabase()
  let directory: string
  let manager: InstanceType<typeof FileManager>

  beforeEach(async () => {
    MockMainCacheServiceUtils.resetMocks()
    directory = await mkdtemp(path.join(tmpdir(), 'cherry-generated-file-'))
    await mkdir(path.join(directory, 'files'))
    vi.mocked(application.getPath).mockImplementation((_key: string, filename?: string) =>
      path.join(directory, 'files', filename ?? '')
    )
    BaseService.resetInstances()
    manager = new FileManager()
    const container = application.getContainer()
    vi.mocked(application.get).mockImplementation((name: string) =>
      name === 'FileManager' ? manager : container.get(name)
    )
  })

  afterEach(async () => {
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
})
