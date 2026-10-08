import type { VendorBag } from '@main/ai/utils/imageOptions'
import { describe, expect, it, vi } from 'vitest'

import { createImageGenerationModel } from '../imageGenerationModel'
import type { ImageGenerationSubmitInput, ImageGenerationTransport, ImageTransportTaskState } from '../imageTransport'

function makeOptions(
  overrides: Partial<Parameters<ReturnType<typeof createImageGenerationModel>['doGenerate']>[0]> = {}
) {
  return {
    prompt: 'a cat',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
    abortSignal: undefined,
    headers: undefined,
    ...overrides
  } satisfies Parameters<ReturnType<typeof createImageGenerationModel>['doGenerate']>[0]
}

function taskTransport(
  query: (taskId: string, context: { signal: AbortSignal }) => Promise<ImageTransportTaskState>,
  cancel: Extract<ImageGenerationTransport<VendorBag>['task'], { kind: 'supported' }>['cancel'] = {
    kind: 'unsupported'
  }
): ImageGenerationTransport<VendorBag> {
  return {
    submit: vi.fn().mockResolvedValue({ kind: 'submitted', taskId: 'task-1' }),
    supportsInput: () => ({ files: false, mask: false }),
    task: {
      kind: 'supported',
      pollPolicy: {
        initialDelayMs: 0,
        maxAttempts: 3,
        maxElapsedMs: null,
        maxConsecutiveErrors: 2,
        getDelayMs: () => 0
      },
      query,
      cancel
    }
  }
}

describe('createImageGenerationModel.doGenerate', () => {
  it('returns SDK warnings for ignored image and mask inputs', async () => {
    const transport = taskTransport(async () => ({ kind: 'completed', imageUrls: ['https://img/result.png'] }))
    const model = createImageGenerationModel('m', { modelDescriptor: undefined, provider: 'ppio', transport })
    const image = { type: 'file' as const, mediaType: 'image/png', data: 'AQID' }
    const result = await model.doGenerate(makeOptions({ files: [image], mask: image }))
    expect(result.warnings).toEqual([
      { type: 'unsupported', feature: 'files' },
      { type: 'unsupported', feature: 'mask' }
    ])
  })

  it.each([{ num_inference_steps: 20 }, { seed: 42 }, { invented: true }])(
    'rejects wire spellings, duplicate native fields and unknown provider options before submission (%j)',
    async (params) => {
      const transport = taskTransport(async () => ({ kind: 'completed', imageUrls: ['https://img/result.png'] }))
      const model = createImageGenerationModel('m', { modelDescriptor: undefined, provider: 'ppio', transport })
      await expect(model.doGenerate(makeOptions({ providerOptions: { ppio: params } }))).rejects.toThrow()
      expect(transport.submit).not.toHaveBeenCalled()
    }
  )

  it('returns urls for an asynchronous task completion', async () => {
    const query = vi.fn().mockResolvedValue({
      kind: 'completed',
      imageUrls: ['https://img/1.png', 'https://img/2.png']
    })
    const transport = taskTransport(query)
    const model = createImageGenerationModel('m', { modelDescriptor: undefined, provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual(['https://img/1.png', 'https://img/2.png'])
    expect(result.warnings).toEqual([])
    expect(result.response.modelId).toBe('m')
    expect(query).toHaveBeenCalledWith('task-1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('returns urls directly for an immediate completion', async () => {
    const transport: ImageGenerationTransport<VendorBag> = {
      submit: vi.fn().mockResolvedValue({ kind: 'completed', imageUrls: ['https://img/sync.png'] }),
      supportsInput: () => ({ files: false, mask: false }),
      task: { kind: 'unsupported' }
    }
    const model = createImageGenerationModel('m', { modelDescriptor: undefined, provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual(['https://img/sync.png'])
  })

  it('cancels the remote task once when aborted during a query', async () => {
    const controller = new AbortController()
    const cancelRemote = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    const transport = taskTransport(query, { kind: 'supported', cancelRemote })
    const model = createImageGenerationModel('m', { modelDescriptor: undefined, provider: 'ppio', transport })

    await expect(model.doGenerate(makeOptions({ abortSignal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(cancelRemote).toHaveBeenCalledTimes(1)
    expect(cancelRemote).toHaveBeenCalledWith('task-1', expect.objectContaining({ signal: undefined }))
  })

  it('forwards canonical provider params and per-call headers to submit and query', async () => {
    const query = vi.fn().mockResolvedValue({ kind: 'completed', imageUrls: ['https://img/1.png'] })
    const transport = taskTransport(query)
    const submit = vi.fn(async (input: ImageGenerationSubmitInput<VendorBag>) => {
      expect(input.providerParams).toMatchObject({ numInferenceSteps: 20 })
      expect(input.headers).toEqual({ 'x-request': 'one' })
      return { kind: 'submitted' as const, taskId: 'task-1' }
    })
    transport.submit = submit
    const model = createImageGenerationModel('m', { modelDescriptor: undefined, provider: 'ppio', transport })

    const result = await model.doGenerate(
      makeOptions({
        providerOptions: { ppio: { numInferenceSteps: 20 } },
        headers: { 'x-request': 'one' }
      })
    )

    expect(result.images).toEqual(['https://img/1.png'])
    expect(query).toHaveBeenCalledWith('task-1', expect.objectContaining({ headers: { 'x-request': 'one' } }))
  })

  it('rejects a task submission from a transport without task capability', async () => {
    const transport: ImageGenerationTransport<VendorBag> = {
      submit: vi.fn().mockResolvedValue({ kind: 'submitted', taskId: 'task-1' }),
      supportsInput: () => ({ files: false, mask: false }),
      task: { kind: 'unsupported' }
    }
    const model = createImageGenerationModel('m', { modelDescriptor: undefined, provider: 'sync-provider', transport })

    await expect(model.doGenerate(makeOptions())).rejects.toThrow(/does not support task queries/)
  })
})
