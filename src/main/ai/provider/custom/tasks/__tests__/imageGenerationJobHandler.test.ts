/**
 * Unit tests for imageGenerationJobHandler.
 *
 * Covers: the job contract, the async path (submit → poll → download/persist)
 * with its usage record, synchronous submit (imageUrls, no poll), progress
 * reporting, and abort (remote cancel + AbortError). The provider / transport
 * resolution is mocked so the test exercises handler control flow, not vendor
 * wiring.
 *
 * There is deliberately no cross-restart resume coverage: `recovery: 'abandon'`
 * means a job never outlives its process, so `patchMetadata` is asserted absent
 * rather than exercised.
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
  getApiKeysMock,
  getByKeyMock,
  resolveProviderAiSdkConfigMock,
  recordRequestMock
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
  getApiKeysMock: vi.fn(),
  getByKeyMock: vi.fn(),
  resolveProviderAiSdkConfigMock: vi.fn(),
  recordRequestMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('../../imageTransportRegistry', () => ({ resolveImageTransport: resolveImageTransportMock }))
vi.mock('../../../config', () => ({ resolveProviderAiSdkConfig: resolveProviderAiSdkConfigMock }))
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: getByProviderIdMock, getApiKeys: getApiKeysMock }
}))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: getByKeyMock } }))
vi.mock('@main/data/services/AiUsageRecordService', () => ({
  aiUsageRecordService: { recordInvocation: recordRequestMock }
}))
vi.mock('@main/ai/utils/usageCapture', () => ({
  createAiUsageCaptureContext: (input: Record<string, unknown>) => ({
    ...input,
    pricingSnapshot: input.pricing
      ? {
          currency: 'USD',
          perImage: { price: 0.02, unit: 'image' },
          capturedAt: '2026-01-01T00:00:00.000Z'
        }
      : null
  })
}))
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
      modelDescriptor: { id: 'qwen-image', endpoint: '/v3/async/qwen-image', isSync: false },
      providerParams: {},
      cleanupPolicy: 'delete_when_unreferenced'
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
  getByProviderIdMock.mockReturnValue({
    id: 'ppio',
    name: 'PPIO',
    reportsActualCost: false
  })
  getApiKeysMock.mockReturnValue([{ id: 'key-a', key: 'submit-key', label: 'Primary', isEnabled: true }])
  getByKeyMock.mockReturnValue({
    id: 'ppio::qwen-image',
    apiModelId: 'qwen-image',
    pricing: { perImage: { price: 0.02 } }
  })
  resolveProviderAiSdkConfigMock.mockResolvedValue({
    config: { providerId: 'ppio', providerSettings: { apiKey: 'k' } }
  })
  recordRequestMock.mockReturnValue(undefined)
  cancelMock.mockResolvedValue(undefined)
  permanentDeleteMock.mockResolvedValue(undefined)
  resolveImageTransportMock.mockReturnValue({ submit: submitMock, poll: pollMock, cancel: cancelMock })
  downloadMock.mockResolvedValue({ data: 'AAAA', media_type: 'image/png' })
  createInternalEntryMock.mockImplementation(async () => ({ id: 'file-1' }))
})

describe('imageGenerationJobHandler contract', () => {
  it('declares the remote-poll job contract', () => {
    // `abandon`, not `retry`: the job's only consumer is the in-process awaiter,
    // so a resumed run would re-pay the vendor and deliver into a dead promise.
    expect(imageGenerationJobHandler.recovery).toBe('abandon')
    expect(
      imageGenerationJobHandler.defaultQueue?.({
        uniqueModelId: 'ppio::qwen-image',
        n: 1,
        providerParams: {},
        cleanupPolicy: 'delete_when_unreferenced'
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
  it('async: submit(taskId) → poll → download/persist, recording usage', async () => {
    const credentialReceipt = {
      attribution: 'explicit',
      id: 'key-a',
      label: 'Primary',
      masked: 'sk-a****aaaa'
    } as const
    const source = { type: 'assistant', id: 'assistant-1', name: 'Image Assistant', icon: '🎨' } as const
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'ppio', providerSettings: { apiKey: 'k' } },
      credentialReceipt
    })
    submitMock.mockResolvedValue({ taskId: 'task-xyz' })
    pollMock.mockImplementation(async (_taskId: string, opts: { onProgress?: (p: number) => void }) => {
      opts.onProgress?.(50)
      return ['https://cdn.example.com/a.png']
    })

    const ctx = createCtx()
    ctx.input.source = source
    const result = (await imageGenerationJobHandler.execute(ctx)) as { files: Array<{ id: string }> }

    expect(result.files).toEqual([{ id: 'file-1' }])
    // The task id is never persisted: nothing resumes a job of this type, so
    // writing it would be metadata with no reader — and a resume that did read it
    // would re-poll a task whose result reaches nobody.
    expect(ctx.patchMetadata).not.toHaveBeenCalled()
    expect(pollMock).toHaveBeenCalledWith(
      'task-xyz',
      expect.objectContaining({ signal: ctx.signal, modelDescriptor: ctx.input.modelDescriptor })
    )
    expect(ctx.reportProgress).toHaveBeenCalledWith(50, { stage: 'polling' })
    expect(ctx.reportProgress).toHaveBeenCalledWith(100, { stage: 'done' })
    expect(downloadMock).toHaveBeenCalledWith('https://cdn.example.com/a.png')
    expect(recordRequestMock).toHaveBeenCalledWith({
      requestId: 'custom-image:img-job-1',
      context: expect.objectContaining({
        providerId: 'ppio',
        modelId: 'qwen-image',
        credentialReceipt,
        source
      }),
      modality: 'image',
      imageCount: 1,
      metrics: { timeCompletionMs: expect.any(Number) },
      completedAt: expect.any(Number)
    })
    // Persisted output entries carry no FileManager ref, so they must be
    // classified for GC reclaim instead of relying on an ad-hoc delete.
    expect(createInternalEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({ cleanupPolicy: 'delete_when_unreferenced' })
    )
  })

  it('passes modelDescriptor through as undefined when the payload carries none', async () => {
    // `AiService` only sets the field when the registry resolved a vendorTransport
    // endpoint, so an absent descriptor is a normal payload — the transport must
    // receive `undefined` rather than the handler throwing on the way there.
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/none.png'] })

    const ctx = createCtx({
      input: {
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'a cat',
        n: 1,
        cleanupPolicy: 'delete_when_unreferenced',
        providerParams: {}
      }
    })
    await imageGenerationJobHandler.execute(ctx)

    const submitArg = submitMock.mock.calls[0][0]
    expect(submitArg.modelDescriptor).toBeUndefined()
  })

  it('sync: submit(imageUrls) → no poll, and no metadata is persisted', async () => {
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/sync.png'] })

    const ctx = createCtx()
    const result = (await imageGenerationJobHandler.execute(ctx)) as { files: Array<{ id: string }> }

    expect(result.files).toEqual([{ id: 'file-1' }])
    expect(pollMock).not.toHaveBeenCalled()
    // The capture context is built per execution and held in memory. Upstream
    // persisted it so a resumed run could still attribute cost; with `abandon`
    // there is no resumed run, so persisting it would be a write nobody reads.
    expect(ctx.patchMetadata).not.toHaveBeenCalled()
    expect(recordRequestMock).toHaveBeenCalledWith(expect.objectContaining({ modality: 'image', imageCount: 1 }))
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
        cleanupPolicy: 'delete_when_unreferenced',
        providerParams: {},
        inputFileIds: ['in-1']
      }
    })
    await imageGenerationJobHandler.execute(ctx)

    expect(readMock).toHaveBeenCalledWith('in-1', { encoding: 'base64' })
    const submitArg = submitMock.mock.calls[0][0]
    expect(submitArg.files).toEqual([{ type: 'file', mediaType: 'image/jpeg', data: 'BBBB' }])
  })

  it('propagates the submit error unchanged (no swallowing/cleanup wrapper)', async () => {
    // The handler owns no compensating delete for its inputs: `job_file_ref` holds
    // them for the job's lifetime, so a failed submit must surface as-is rather
    // than being wrapped by cleanup bookkeeping.
    submitMock.mockRejectedValue(new Error('vendor 500'))

    const ctx = createCtx({
      input: {
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'x',
        n: 1,
        providerParams: {},
        inputFileIds: ['in-1'],
        cleanupPolicy: 'delete_when_unreferenced'
      }
    })
    await expect(imageGenerationJobHandler.execute(ctx)).rejects.toThrow('vendor 500')
    expect(permanentDeleteMock).not.toHaveBeenCalled()
  })

  it('fails (not silently completes) when submit returns neither imageUrls nor a taskId', async () => {
    submitMock.mockResolvedValue({})
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/neither imageUrls nor a taskId/i)
  })

  it('fails when the remote returned URLs but every download fails (paid no-op guard)', async () => {
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] })
    downloadMock.mockResolvedValue(null)
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/all downloads failed/i)
    // The vendor generated (and charged for) both images before the download step,
    // so the usage record must still carry them even though the job surfaces an error.
    expect(recordRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'custom-image:img-job-1', modality: 'image', imageCount: 2 })
    )
  })

  it('returns the subset (does not throw) when only some downloads fail', async () => {
    submitMock.mockResolvedValue({ imageUrls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'] })
    downloadMock.mockImplementation(async (url: string) =>
      url.endsWith('a.png') ? { data: 'AAAA', media_type: 'image/png' } : null
    )
    createInternalEntryMock.mockResolvedValueOnce({ id: 'file-a' })

    const result = (await imageGenerationJobHandler.execute(createCtx())) as { files: Array<{ id: string }> }
    expect(result.files).toEqual([{ id: 'file-a' }])
    // Bills the generated URL count, not the persisted file count.
    expect(recordRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'custom-image:img-job-1', modality: 'image', imageCount: 2 })
    )
  })

  it('persists inline data: URL results without downloading (b64_json-style sync responses)', async () => {
    const inline = 'data:image/jpeg;base64,/9j/4AAQ'
    submitMock.mockResolvedValue({ imageUrls: [inline, 'https://cdn.example.com/b.png'] })
    createInternalEntryMock.mockResolvedValueOnce({ id: 'file-inline' }).mockResolvedValueOnce({ id: 'file-b' })

    const result = (await imageGenerationJobHandler.execute(createCtx())) as { files: Array<{ id: string }> }
    expect(result.files).toEqual([{ id: 'file-inline' }, { id: 'file-b' }])
    expect(downloadMock).toHaveBeenCalledTimes(1)
    expect(downloadMock).toHaveBeenCalledWith('https://cdn.example.com/b.png')
    expect(createInternalEntryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ source: 'base64', data: inline })
    )
  })

  it('fails when submit returns an empty imageUrls array (paid no-op guard)', async () => {
    submitMock.mockResolvedValue({ imageUrls: [] })
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/returned no image URLs/i)
    expect(recordRequestMock).toHaveBeenCalledWith(expect.objectContaining({ imageCount: 0 }))
  })

  it('fails when poll returns an empty array (paid no-op guard)', async () => {
    submitMock.mockResolvedValue({ taskId: 'task-empty' })
    pollMock.mockResolvedValue([])
    await expect(imageGenerationJobHandler.execute(createCtx())).rejects.toThrow(/returned no image URLs/i)
    expect(recordRequestMock).toHaveBeenCalledWith(expect.objectContaining({ imageCount: 0 }))
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
