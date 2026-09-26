import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobContext } from '@main/core/job/types'

import type { VideoGenerationJobInput } from '../../videoGenerationModel'

const {
  appGetMock,
  dbUpdateMock,
  getByProviderIdMock,
  getByKeyMock,
  resolveApiKeyMock,
  resolveVideoTransportMock,
  submitMock,
  pollMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  getByKeyMock: vi.fn(),
  resolveApiKeyMock: vi.fn(),
  resolveVideoTransportMock: vi.fn(),
  submitMock: vi.fn(),
  pollMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: getByKeyMock } }))
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: getByProviderIdMock, resolveApiKey: resolveApiKeyMock }
}))
vi.mock('../../videoTransports/videoTransportRegistry', () => ({ resolveVideoTransport: resolveVideoTransportMock }))

const { videoGenerationJobHandler } = await import('../videoGenerationJobHandler')

function createCtx(overrides: Partial<JobContext<VideoGenerationJobInput>> = {}): JobContext<VideoGenerationJobInput> {
  const controller = new AbortController()
  return {
    jobId: 'video-job-1',
    input: {
      videoId: 'video-1',
      uniqueModelId: 'kling::kling-v2',
      prompt: 'a cat flying'
    },
    attempt: 0,
    signal: controller.signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...overrides
  } as JobContext<VideoGenerationJobInput>
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'DbService') {
      return {
        getDb: () => ({
          update: () => ({
            set: () => ({
              where: () => ({ run: dbUpdateMock })
            })
          })
        })
      }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
  getByProviderIdMock.mockReturnValue({ id: 'kling', name: 'Kling' })
  getByKeyMock.mockReturnValue({ id: 'kling::kling-v2' })
  resolveApiKeyMock.mockReturnValue({ value: 'sk-key' })
  resolveVideoTransportMock.mockReturnValue({ submit: submitMock, poll: pollMock })
  submitMock.mockResolvedValue('provider-task-1')
})

describe('videoGenerationJobHandler.execute', () => {
  it('resolves the API key scoped to the requested model, so a model-scoped quota is honoured', async () => {
    pollMock.mockResolvedValue('https://cdn.example.com/video.mp4')

    await videoGenerationJobHandler.execute(createCtx())

    expect(resolveApiKeyMock).toHaveBeenCalledWith('kling', undefined, 'kling::kling-v2')
  })

  it('completes with the video URL once the transport reports done', async () => {
    pollMock.mockResolvedValue('https://cdn.example.com/video.mp4')

    const result = await videoGenerationJobHandler.execute(createCtx())

    expect(result).toEqual({ videoUrl: 'https://cdn.example.com/video.mp4' })
  })
})
