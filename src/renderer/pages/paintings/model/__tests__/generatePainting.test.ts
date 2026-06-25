import type { FileMetadata } from '@renderer/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runPaintingMock = vi.fn(async (generate: () => Promise<unknown>) => {
  await generate()
  return [] as FileMetadata[]
})

vi.mock('../runPainting', () => ({
  runPainting: (generate: () => Promise<unknown>) => runPaintingMock(generate)
}))

// Image generation goes through ipcApi.request('ai.generate_image', { requestId, payload }).
const { ipcRequestMock } = vi.hoisted(() => ({ ipcRequestMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

import type { GeneratePaintingOptions } from '../generatePainting'
import { generatePainting } from '../generatePainting'

function makeOptions(
  aiSdkParams: GeneratePaintingOptions['aiSdkParams'],
  signal: AbortSignal = new AbortController().signal
): GeneratePaintingOptions {
  return {
    provider: {
      id: 'aihubmix',
      name: 'AiHubMix',
      apiHost: 'https://aihubmix.com',
      isEnabled: true,
      getApiKey: async () => 'sk'
    },
    signal,
    modelId: 'gpt-image-1',
    prompt: 'a fox',
    aiSdkParams
  }
}

describe('generatePainting', () => {
  beforeEach(() => {
    runPaintingMock.mockClear()
    ipcRequestMock.mockReset()
    ipcRequestMock.mockImplementation(async (route: string) =>
      route === 'ai.generate_image' ? { files: [] } : undefined
    )
  })

  // The image payload now rides in the second arg as `{ requestId, payload }`.
  const imagePayload = (): Record<string, unknown> => {
    const call = ipcRequestMock.mock.calls.find(([route]) => route === 'ai.generate_image')
    if (!call) throw new Error('ai.generate_image was not requested')
    return (call[1] as { payload: Record<string, unknown> }).payload
  }

  it("forwards the 'auto' size sentinel as-is for main to omit", async () => {
    await generatePainting(makeOptions({ imageSize: 'auto' }))

    expect(imagePayload()).toMatchObject({
      uniqueModelId: 'aihubmix::gpt-image-1',
      prompt: 'a fox',
      size: 'auto'
    })
  })

  it('keeps concrete imageSize as the IPC size', async () => {
    await generatePainting(makeOptions({ imageSize: '1024x1024' }))

    expect(imagePayload()).toMatchObject({
      size: '1024x1024'
    })
  })

  // A provider failure now crosses IpcApi as an IpcError (name 'IpcError'), which no longer
  // satisfies runPainting's `name === 'AbortError'` silent-cancel check — generatePainting's
  // `.catch` re-derives a real AbortError only when the user aborted, else re-throws the original.
  it('re-throws a real AbortError when the request rejects after the user aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'ai.generate_image') throw new Error('cancelled by main')
      return undefined
    })

    await expect(generatePainting(makeOptions({}, controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('re-throws the original error when the request rejects without a user abort', async () => {
    const failure = new Error('provider exploded')
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'ai.generate_image') throw failure
      return undefined
    })

    await expect(generatePainting(makeOptions({}))).rejects.toBe(failure)
  })
})
