import type { FileEntry } from '@shared/data/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Adapt FileEntry → FileMetadata is exercised elsewhere; here we only need the id to flow through.
vi.mock('../../../paintings/utils/fileEntryAdapter', () => ({
  fileEntryToMetadata: vi.fn(async (entry: FileEntry) => ({ id: entry.id, name: entry.name }))
}))

interface VideoPayload {
  uniqueModelId?: string
  prompt?: string
  firstFrame?: string
  lastFrame?: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  fps?: number
  seed?: number
  negativePrompt?: string
  providerOptions?: Record<string, Record<string, unknown>>
}

const { ipcRequestMock } = vi.hoisted(() => ({
  ipcRequestMock: vi.fn(async (route: string, _input: unknown): Promise<unknown> => {
    if (route === 'ai.generate_video') return { files: [{ id: 'out-1', name: 'out-1.mp4' }] }
    return undefined
  })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

import { generateVideoRequest } from '../generateVideo'

const binaryImage = vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' }))

/** Calls to the `ai.generate_video` route: `[{ requestId, payload }]`. */
function generateCalls(): Array<{ requestId: string; payload: VideoPayload }> {
  return ipcRequestMock.mock.calls
    .filter(([route]) => route === 'ai.generate_video')
    .map(([, input]) => input as { requestId: string; payload: VideoPayload })
}

/** Calls to the `ai.abort_video` route: `[{ requestId }]`. */
function abortCalls(): Array<{ requestId: string }> {
  return ipcRequestMock.mock.calls
    .filter(([route]) => route === 'ai.abort_video')
    .map(([, input]) => input as { requestId: string })
}

beforeEach(() => {
  ipcRequestMock.mockClear()
  binaryImage.mockClear()
  vi.stubGlobal('window', {
    api: { file: { binaryImage } }
  })
})

const frame = (id: string): FileEntry => ({ id, name: id }) as unknown as FileEntry

describe('generateVideoRequest', () => {
  it('partitions canonical params: top-level fields stay flat, the rest go under providerOptions[providerId]', async () => {
    await generateVideoRequest({
      providerId: 'dmxapi',
      modelId: 'seedance',
      prompt: 'a cat',
      params: {
        resolution: '720p',
        aspectRatio: '16:9',
        negativePrompt: 'blurry',
        // vendor-specific → provider bag
        cameraFixed: true,
        watermark: false
      },
      signal: new AbortController().signal
    })

    const calls = generateCalls()
    expect(calls).toHaveLength(1)
    const { requestId, payload } = calls[0]
    expect(typeof requestId).toBe('string')
    expect(payload).toMatchObject({
      uniqueModelId: 'dmxapi::seedance',
      prompt: 'a cat',
      resolution: '720p',
      aspectRatio: '16:9',
      negativePrompt: 'blurry',
      providerOptions: { dmxapi: { cameraFixed: true, watermark: false } }
    })
    // top-level keys must NOT leak into the provider bag
    expect(payload.providerOptions?.dmxapi).not.toHaveProperty('resolution')
  })

  it('drops empty / undefined / "auto" values and coerces numeric strings', async () => {
    await generateVideoRequest({
      providerId: 'ppio',
      modelId: 'kling',
      prompt: 'x',
      params: { duration: '5', fps: 24, seed: '', resolution: 'auto', negativePrompt: undefined },
      signal: new AbortController().signal
    })

    const { payload } = generateCalls()[0]
    expect(payload.duration).toBe(5) // "5" → 5
    expect(payload.fps).toBe(24)
    expect(payload).not.toHaveProperty('seed') // "" dropped
    expect(payload).not.toHaveProperty('resolution') // "auto" dropped
    expect(payload).not.toHaveProperty('negativePrompt') // undefined dropped
    expect(payload).not.toHaveProperty('providerOptions') // nothing vendor-specific
  })

  it('encodes first/last frame to data URLs and returns adapted output files', async () => {
    const result = await generateVideoRequest({
      providerId: 'google',
      modelId: 'veo-3',
      prompt: 'p',
      firstFrame: frame('first'),
      lastFrame: frame('last'),
      params: {},
      signal: new AbortController().signal
    })

    expect(binaryImage).toHaveBeenCalledWith('first')
    expect(binaryImage).toHaveBeenCalledWith('last')
    const { payload } = generateCalls()[0]
    expect(payload.firstFrame).toMatch(/^data:image\/png;base64,/)
    expect(payload.lastFrame).toMatch(/^data:image\/png;base64,/)
    expect(result).toEqual([{ id: 'out-1', name: 'out-1.mp4' }])
  })

  it('forwards an abort to the ai.abort_video route with the same requestId', async () => {
    const controller = new AbortController()
    let resolveGen: (v: unknown) => void = () => {}
    ipcRequestMock.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          resolveGen = resolve
        })
    )

    const promise = generateVideoRequest({
      providerId: 'google',
      modelId: 'veo-3',
      prompt: 'p',
      params: {},
      signal: controller.signal
    })

    controller.abort()
    const aborts = abortCalls()
    expect(aborts).toHaveLength(1)
    const { requestId } = generateCalls()[0]
    expect(aborts[0]).toEqual({ requestId })

    resolveGen({ files: [] })
    // the post-await aborted check throws AbortError
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})
