import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FileEntrySchema } from '@shared/data/types/file'

import { paintingGenerate } from '../paintingPipeline'
import type { GenerateInput } from '../types/generateInput'
import type { PaintingData } from '../types/paintingData'

const { prefetchMock, ipcRequestMock } = vi.hoisted(() => ({ prefetchMock: vi.fn(), ipcRequestMock: vi.fn() }))
vi.mock('@data/hooks/useDataApi', () => ({ prefetch: prefetchMock }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

const image = FileEntrySchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  cleanupPolicy: 'manual',
  origin: 'internal',
  name: 'reference',
  ext: 'png',
  size: 3,
  contentHash: null,
  createdAt: 0,
  updatedAt: 0
})

function makeInput(overrides: Partial<PaintingData> = {}): GenerateInput {
  return {
    painting: {
      id: 'p1',
      providerId: 'aihubmix',
      mode: 'generate',
      model: 'image-model',
      prompt: 'a fox',
      files: [],
      params: {},
      ...overrides
    },
    provider: {
      id: 'aihubmix',
      name: 'AiHubMix',
      apiHost: 'https://example.com',
      isEnabled: true,
      getApiKey: async () => 'api-key'
    },
    tab: 'default',
    abortController: new AbortController()
  }
}

function sentPayload() {
  return ipcRequestMock.mock.calls.find(([route]) => route === 'ai.image.generate')?.[1]?.payload
}

describe('paintingGenerate', () => {
  beforeEach(() => {
    prefetchMock.mockReset()
    ipcRequestMock.mockReset().mockResolvedValue({ files: [image] })
    Object.assign(window, {
      api: {
        file: {
          binaryImage: vi.fn().mockResolvedValue({ data: [1, 2, 3], mime: 'image/png' }),
          getPhysicalPath: vi.fn().mockResolvedValue('/generated.png')
        }
      }
    })
  })

  it('sends edit mode and encoded references despite a saved generate mode', async () => {
    prefetchMock.mockResolvedValue({
      modes: { generate: { supports: {} }, edit: { requirePrompt: true, supports: {} } }
    })
    const result = await paintingGenerate(makeInput({ mode: 'generate', inputFiles: [image] }))
    expect(sentPayload()).toMatchObject({ mode: 'edit', inputImages: ['data:image/png;base64,AQID'] })
    expect(result[0]).toMatchObject({ path: '/generated.png', ext: '.png' })
  })

  it('sends generation when the selected model only supports generation', async () => {
    prefetchMock.mockResolvedValue({ modes: { generate: { supports: {} } } })
    await paintingGenerate(makeInput({ mode: 'edit' }))
    expect(sentPayload()).toMatchObject({ mode: 'generate', uniqueModelId: 'aihubmix::image-model' })
  })

  it('honors an edit-only model that allows empty prompts', async () => {
    prefetchMock.mockResolvedValue({ modes: { edit: { requirePrompt: false, supports: {} } } })
    await paintingGenerate(makeInput({ mode: 'edit', prompt: '', inputFiles: [image] }))
    expect(sentPayload()).toMatchObject({ mode: 'edit', prompt: '' })
  })

  it('still sends reference image bytes when metadata is unavailable', async () => {
    prefetchMock.mockRejectedValue(new Error('offline'))
    await paintingGenerate(makeInput({ inputFiles: [image] }))
    expect(sentPayload()).toMatchObject({ inputImages: ['data:image/png;base64,AQID'] })
  })

  it('rejects missing model IDs before requesting generation', async () => {
    await expect(paintingGenerate(makeInput({ model: undefined }))).rejects.toMatchObject({
      code: 'MISSING_REQUIRED_FIELDS'
    })
    expect(ipcRequestMock).not.toHaveBeenCalled()
  })

  it.each([
    ['dashscope', 900_000, undefined, 900_000],
    ['dashscope', 900_000, 30_000, 30_000],
    ['dashscope', undefined, undefined, undefined],
    ['dmxapi', 900_000, undefined, undefined]
  ])('resolves the request timeout for %s', async (id, saved, draft, expected) => {
    prefetchMock.mockResolvedValue({ modes: { generate: { supports: {} } } })
    ipcRequestMock.mockReset().mockResolvedValue({ files: [image] })
    const input = makeInput({ providerId: id, requestTimeoutMs: draft })
    input.provider = { ...input.provider, id, imageRequestTimeoutMs: saved }
    await paintingGenerate(input)
    if (expected === undefined) expect(sentPayload()).not.toHaveProperty('requestTimeoutMs')
    else expect(sentPayload().requestTimeoutMs).toBe(expected)
  })
})
