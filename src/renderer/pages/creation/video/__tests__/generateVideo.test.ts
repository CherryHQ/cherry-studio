import type { FileEntry } from '@shared/data/types/file'
import type { VideoGenerationSupport } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Adapt FileEntry → FileMetadata is exercised elsewhere; here we only need the id to flow through.
vi.mock('../../utils/fileEntryAdapter', () => ({
  fileEntryToMetadata: vi.fn(async (entry: FileEntry) => ({ id: entry.id, name: entry.name }))
}))

const { ipcRequestMock } = vi.hoisted(() => ({
  ipcRequestMock: vi.fn(async (route: string, _input: unknown): Promise<unknown> => {
    if (route === 'ai.generate_video') return { files: [{ id: 'out-1', name: 'out-1.mp4' }] }
    return undefined
  })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

import { generateVideoRequest } from '../generateVideo'

interface VideoPayload {
  uniqueModelId?: string
  prompt?: string
  firstFrame?: string
  lastFrame?: string
  paramValues: Record<string, unknown>
}

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
  it('ships the whole canonical bag as paramValues (no renderer-side partition)', async () => {
    await generateVideoRequest({
      providerId: 'dmxapi',
      modelId: 'seedance',
      prompt: 'a cat',
      params: {
        resolution: '720p',
        aspectRatio: '16:9',
        negativePrompt: 'blurry',
        cameraFixed: true,
        watermark: false
      },
      signal: new AbortController().signal
    })

    const calls = generateCalls()
    expect(calls).toHaveLength(1)
    const { requestId, payload } = calls[0]
    expect(typeof requestId).toBe('string')
    expect(payload).toEqual({
      uniqueModelId: 'dmxapi::seedance',
      prompt: 'a cat',
      paramValues: {
        resolution: '720p',
        aspectRatio: '16:9',
        negativePrompt: 'blurry',
        cameraFixed: true,
        watermark: false
      }
    })
  })

  it('coerces via the catalog and enforces per-model constraints when support is given', async () => {
    const support = {
      modes: {
        t2v: {
          supports: {
            duration: { type: 'enum', options: ['5', '10'] },
            seed: { type: 'text' },
            cfg: { type: 'range', min: 1, max: 10 }
          }
        }
      }
    } as unknown as VideoGenerationSupport

    await generateVideoRequest({
      providerId: 'ppio',
      modelId: 'kling',
      prompt: 'x',
      params: { duration: '5', seed: '42', cfg: 99, resolution: 'auto', negativePrompt: undefined },
      support,
      mode: 't2v',
      signal: new AbortController().signal
    })

    const { payload } = generateCalls()[0]
    expect(payload.paramValues.duration).toBe(5) // "5" → 5 via the catalog
    expect(payload.paramValues.seed).toBe(42)
    expect(payload.paramValues).not.toHaveProperty('cfg') // out of range → dropped, submit survives
    // 'auto'/undefined blanks are dropped from the bag; 'auto' resolution rides
    // through the schema but main's split also guards it — the bag simply omits blanks.
    expect(payload.paramValues).not.toHaveProperty('negativePrompt')
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
