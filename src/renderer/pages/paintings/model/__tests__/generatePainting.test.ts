import type { FileMetadata } from '@renderer/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runPaintingMock = vi.fn(async (generate: () => Promise<unknown>) => {
  await generate()
  return [] as FileMetadata[]
})

vi.mock('../runPainting', () => ({
  runPainting: (generate: () => Promise<unknown>) => runPaintingMock(generate)
}))

import type { GeneratePaintingOptions } from '../generatePainting'
import { generatePainting } from '../generatePainting'

function makeOptions(aiSdkParams: GeneratePaintingOptions['aiSdkParams']): GeneratePaintingOptions {
  return {
    provider: {
      id: 'aihubmix',
      name: 'AiHubMix',
      apiHost: 'https://aihubmix.com',
      isEnabled: true,
      getApiKey: async () => 'sk'
    },
    signal: new AbortController().signal,
    modelId: 'gpt-image-1',
    prompt: 'a fox',
    aiSdkParams
  }
}

describe('generatePainting', () => {
  const originalApi = (window as unknown as { api?: unknown }).api
  let generateImage: ReturnType<typeof vi.fn>
  let abortImage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    runPaintingMock.mockClear()
    generateImage = vi.fn(async () => ({ files: [] }))
    abortImage = vi.fn()
    ;(window as unknown as { api: unknown }).api = {
      ai: {
        generateImage,
        abortImage
      }
    }
  })

  afterEach(() => {
    ;(window as unknown as { api?: unknown }).api = originalApi
  })

  it("forwards the 'auto' size sentinel as-is for main to omit", async () => {
    await generatePainting(makeOptions({ imageSize: 'auto' }))

    const payload = generateImage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      uniqueModelId: 'aihubmix::gpt-image-1',
      prompt: 'a fox',
      size: 'auto'
    })
  })

  it('keeps concrete imageSize as the IPC size', async () => {
    await generatePainting(makeOptions({ imageSize: '1024x1024' }))

    const payload = generateImage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      size: '1024x1024'
    })
  })
})
