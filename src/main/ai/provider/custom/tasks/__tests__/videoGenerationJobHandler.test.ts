import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobContext } from '@main/core/job/types'

import type { VideoGenerationJobInput } from '../../videoGenerationModel'

const {
  appGetMock,
  dbSetMock,
  getByProviderIdMock,
  getByKeyMock,
  resolveApiKeyMock,
  resolveVideoTransportMock,
  submitMock,
  pollMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  dbSetMock: vi.fn(),
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
            set: (values: Record<string, unknown>) => {
              dbSetMock(values)
              return { where: () => ({ run: vi.fn() }) }
            }
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

  it('marks the row failed (not left processing) when a poll error is thrown', async () => {
    pollMock.mockRejectedValue(new Error('provider 500'))

    await expect(videoGenerationJobHandler.execute(createCtx())).rejects.toThrow('provider 500')

    expect(dbSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('provider 500') })
    )
  })

  it('marks the row failed (not left pending) when the provider cannot be found', async () => {
    getByProviderIdMock.mockReturnValue(undefined)

    await expect(videoGenerationJobHandler.execute(createCtx())).rejects.toThrow(/provider 'kling' not found/)

    expect(dbSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('marks the row failed (not left pending) when the model cannot be found', async () => {
    getByKeyMock.mockReturnValue(undefined)

    await expect(videoGenerationJobHandler.execute(createCtx())).rejects.toThrow(/model 'kling-v2' not found/)

    expect(dbSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('marks the row failed (not left pending) when no transport is registered for the provider', async () => {
    resolveVideoTransportMock.mockReturnValue(null)

    await expect(videoGenerationJobHandler.execute(createCtx())).rejects.toThrow(/no transport for provider/)

    expect(dbSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('marks the row failed (not left pending) when submit itself throws', async () => {
    submitMock.mockRejectedValue(new Error('submit boom'))

    await expect(videoGenerationJobHandler.execute(createCtx())).rejects.toThrow('submit boom')

    expect(dbSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('submit boom') })
    )
  })

  it('marks the row failed (not left processing forever) when the job is cancelled mid-poll', async () => {
    const controller = new AbortController()
    pollMock.mockImplementation(async (_taskId: string, signal: AbortSignal) => {
      controller.abort()
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      return null
    })

    await expect(videoGenerationJobHandler.execute(createCtx({ signal: controller.signal }))).rejects.toThrow()

    expect(dbSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('marks the row failed when the job is cancelled while sleeping between polls', async () => {
    const controller = new AbortController()
    pollMock.mockImplementation(async () => {
      // Not done yet, but cancelled right after — the abort must be caught at the
      // sleepWithSignal() call between polls, not just inside poll() itself.
      controller.abort()
      return null
    })

    await expect(videoGenerationJobHandler.execute(createCtx({ signal: controller.signal }))).rejects.toThrow()

    expect(dbSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
})
