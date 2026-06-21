/**
 * Unit tests for imageGenerationJobHandler.
 *
 * Covers: the job contract, first-launch async path (submit → patchMetadata →
 * poll → download/persist), cross-restart resume (metadata.taskId present →
 * skip submit), synchronous submit (imageUrls, no poll / no patchMetadata),
 * progress reporting, and abort (remote cancel + AbortError). The provider /
 * transport resolution is mocked so the test exercises handler control flow,
 * not vendor wiring.
 */
import type { JobContext } from '@main/core/job/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImageGenerationJobPayload } from '../jobTypes'

const {
  appGetMock,
  readMock,
  createInternalEntryMock,
  permanentDeleteMock,
  resolveImageTransportMock,
  submitMock,
  pollMock,
  cancelMock,
  downloadMock,
  getByProviderIdMock,
  getByKeyMock,
  providerToAiSdkConfigMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  readMock: vi.fn(),
  createInternalEntryMock: vi.fn(),
  permanentDeleteMock: vi.fn(),
  resolveImageTransportMock: vi.fn(),
  submitMock: vi.fn(),
  pollMock: vi.fn(),
  cancelMock: vi.fn(),
  downloadMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  getByKeyMock: vi.fn(),
  providerToAiSdkConfigMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('../../imageTransportRegistry', () => ({ resolveImageTransport: resolveImageTransportMock }))
vi.mock('../../../config', () => ({ providerToAiSdkConfig: providerToAiSdkConfigMock }))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: getByProviderIdMock } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: getByKeyMock } }))
vi.mock('@main/utils/downloadAsBase64', () => ({ downloadImageAsBase64: downloadMock }))

const { imageGenerationJobHandler } = await import('../imageGenerationJobHandler')

function createCtx(
  overrides: Partial<JobContext<ImageGenerationJobPayload>> = {}
): JobContext<ImageGenerationJobPayload> {
  const controller = new AbortController()
  return {
    jobId: 'img-job-1',
    input: {
      uniqueModelId: 'ppio::qwen-image',
      prompt: 'a cat',
      n: 1,
      size: '1024x1024',
      providerParams: { modelDescriptor: { id: 'qwen-image', isSync: false } }
    },
    attempt: 0,
    signal: controller.signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...overrides
  } as JobContext<ImageGenerationJobPayload>
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileManager') {
      return { read: readMock, createInternalEntry: createInternalEntryMock, permanentDelete: permanentDeleteMock }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
  getByProviderIdMock.mockResolvedValue({ id: 'ppio' })
  getByKeyMock.mockResolvedValue({ id: 'qwen-image', apiModelId: 'qwen-image' })
  providerToAiSdkConfigMock.mockResolvedValue({ providerId: 'ppio', providerSettings: { apiKey: 'k' } })
  cancelMock.mockResolvedValue(undefined)
  permanentDeleteMock.mockResolvedValue(undefined)
  resolveImageTransportMock.mockReturnValue({ submit: submitMock, poll: pollMock, cancel: cancelMock })
  downloadMock.mockResolvedValue({ data: 'AAAA', media_type: 'image/png' })
  createInternalEntryMock.mockImplementation(async () => ({ id: 'file-1' }))
})

describe('imageGenerationJobHandler contract', () => {
  it('declares the remote-poll job contract', () => {
    expect(imageGenerationJobHandler.recovery).toBe('retry')
    expect(
      imageGenerationJobHandler.defaultQueue?.({
        uniqueModelId: 'ppio::qwen-image',
        n: 1,
        providerParams: {}
      })
    ).toBe('image-generation.ppio')
    expect(imageGenerationJobHandler.defaultConcurrency).toBe(2)
    expect(imageGenerationJobHandler.defaultRetryPolicy).toEqual({
      maxAttempts: 1,
      backoff: 'none',
      baseDelayMs: 0,
      maxDelayMs: 0
    })
    expect(imageGenerationJobHandler.defaultTimeoutMs).toBe(30 * 60_000)
  })
})

describe('imageGenerationJobHandler.execute', () => {
  it('async: submit(taskId) → patchMetadata → poll → download/persist', async () => {
    submitMock.mockResolvedValue({ taskId: 'task-xyz' })
    pollMock.mockImplementation(async (_taskId: string, opts: { onProgress?: (p: number) => void }) => {
      opts.onProgress?.(50)
      return ['https://cdn.example.com/a.png']
    })

    const ctx = createCtx()
    const result = (await imageGenerationJobHandler.execute(ctx)) as { files: Array<{ id: string }> }

    expect(result.files).toEqual([{ id: 'file-1' }])
    expect(ctx.patchMetadata).toHaveBeenCalledWith({ taskId: 'task-xyz' })
    expect(pollMock).toHaveBeenCalledWith(
      'task-xyz',
      expect.objectContaining({ signal: ctx.signal, providerParams: ctx.input.providerParams })
    )
    expect(ctx.reportProgress).toHaveBeenCalledWith(50, { stage: 'polling' })
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done' })
    expect(downloadMock).toHaveBeenCalledWith('https://cdn.example.com/a.png')
  })

  it('resume: metadata.taskId present → skips submit, polls the persisted task', async () => {
    pollMock.mockResolvedValue(['https://cdn.example.com/b.png'])

    const ctx = createCtx({ metadata: { taskId: 'resumed-task' } })
    await imageGenerationJobHandler.execute(ctx)

    expect(submitMock).not.toHaveBeenCalled()
    expect(ctx.patchMetadata).not.toHaveBeenCalled()
    // Resume must re-supply the submit-time vendor bag so a stateful transport
    // (DashScope) can rebuild its response-family descriptor.
    expect(pollMock).toHaveBeenCalledWith(
      'resumed-task',
      expect.objectContaining({ signal: ctx.signal, providerParams: ctx.input.providerParams })
    )
  })

  it('sync: submit(imageUrls) → no poll, no patchMetadata', async () => {
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/sync.png'] })

    const ctx = createCtx()
    const result = (await imageGenerationJobHandler.execute(ctx)) as { files: Array<{ id: string }> }

    expect(result.files).toEqual([{ id: 'file-1' }])
    expect(pollMock).not.toHaveBeenCalled()
    expect(ctx.patchMetadata).not.toHaveBeenCalled()
  })

  it('abort: cancels the remote task and throws AbortError', async () => {
    submitMock.mockResolvedValue({ taskId: 'task-to-cancel' })
    const controller = new AbortController()
    controller.abort()
    const ctx = createCtx({ signal: controller.signal })

    await expect(imageGenerationJobHandler.execute(ctx)).rejects.toThrow(/abort/i)
    expect(cancelMock).toHaveBeenCalledWith('task-to-cancel')
    expect(pollMock).not.toHaveBeenCalled()
  })

  it('reads input images by FileEntry id for image-edit submit', async () => {
    readMock.mockResolvedValue({ content: 'BBBB', mime: 'image/jpeg' })
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/edit.png'] })

    const ctx = createCtx({
      input: {
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'edit',
        n: 1,
        providerParams: {},
        inputFileIds: ['in-1']
      }
    })
    await imageGenerationJobHandler.execute(ctx)

    expect(readMock).toHaveBeenCalledWith('in-1', { encoding: 'base64' })
    const submitArg = submitMock.mock.calls[0][0]
    expect(submitArg.files).toEqual([{ type: 'file', mediaType: 'image/jpeg', data: 'BBBB' }])
  })

  it('deletes the temp input/mask entries after completion (no storage leak)', async () => {
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/edit.png'] })
    readMock.mockResolvedValue({ content: 'BBBB', mime: 'image/jpeg' })

    const ctx = createCtx({
      input: {
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'edit',
        n: 1,
        providerParams: {},
        inputFileIds: ['in-1', 'in-2'],
        maskFileId: 'mask-1'
      }
    })
    await imageGenerationJobHandler.execute(ctx)

    expect(permanentDeleteMock).toHaveBeenCalledWith('in-1')
    expect(permanentDeleteMock).toHaveBeenCalledWith('in-2')
    expect(permanentDeleteMock).toHaveBeenCalledWith('mask-1')
  })

  it('deletes the temp input entries even when the job fails', async () => {
    submitMock.mockRejectedValue(new Error('vendor 500'))

    const ctx = createCtx({
      input: { uniqueModelId: 'ppio::qwen-image', prompt: 'x', n: 1, providerParams: {}, inputFileIds: ['in-1'] }
    })
    await expect(imageGenerationJobHandler.execute(ctx)).rejects.toThrow('vendor 500')
    expect(permanentDeleteMock).toHaveBeenCalledWith('in-1')
  })

  it('fails (not silently completes) when submit returns neither imageUrls nor a taskId', async () => {
    submitMock.mockResolvedValue({})
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/neither imageUrls nor a taskId/i)
  })

  it('fails when the remote returned URLs but every download fails (paid no-op guard)', async () => {
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/a.png'] })
    downloadMock.mockResolvedValue(null)
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/all downloads failed/i)
  })

  it('returns the subset (does not throw) when only some downloads fail', async () => {
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] })
    downloadMock.mockImplementation(async (url: string) =>
      url.endsWith('a.png') ? { data: 'AAAA', media_type: 'image/png' } : null
    )
    createInternalEntryMock.mockResolvedValueOnce({ id: 'file-a' })

    const result = (await imageGenerationJobHandler.execute(createCtx())) as { files: Array<{ id: string }> }
    expect(result.files).toEqual([{ id: 'file-a' }])
  })

  it('fails when submit returns an empty imageUrls array (paid no-op guard)', async () => {
    submitMock.mockResolvedValue({ imageUrls: [] })
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/returned no image URLs/i)
  })

  it('fails when poll returns an empty array (paid no-op guard)', async () => {
    submitMock.mockResolvedValue({ taskId: 'task-empty' })
    pollMock.mockResolvedValue([])
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/returned no image URLs/i)
  })

  it('cancels the remote task when the signal aborts mid-poll', async () => {
    const controller = new AbortController()
    submitMock.mockResolvedValue({ taskId: 'task-mid' })
    // Abort while transport.poll is in flight → the abort listener registered in
    // pollUntilDone fires cancelRemote (the realistic mid-poll path, distinct from
    // the pre-aborted early-return). The post-poll download then sees the aborted
    // signal and throws, so execute rejects.
    pollMock.mockImplementation(async () => {
      controller.abort()
      return ['https://cdn.example.com/a.png']
    })

    await expect(imageGenerationJobHandler.execute(createCtx({ signal: controller.signal }))).rejects.toThrow(/abort/i)
    expect(pollMock).toHaveBeenCalled()
    expect(cancelMock).toHaveBeenCalledWith('task-mid')
  })

  it('throws when transport resolution yields nothing', async () => {
    resolveImageTransportMock.mockReturnValue(null)
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/no async transport/i)
  })
})
