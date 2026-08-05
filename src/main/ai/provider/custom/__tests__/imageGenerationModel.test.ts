import type { WireVendorBag } from '@main/ai/utils/imageOptions'
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
  } as Parameters<ReturnType<typeof createImageGenerationModel>['doGenerate']>[0]
}

function taskTransport(
  query: (taskId: string, context: { signal: AbortSignal }) => Promise<ImageTransportTaskState>,
  cancel: Extract<ImageGenerationTransport<WireVendorBag>['task'], { kind: 'supported' }>['cancel'] = {
    kind: 'unsupported'
  }
): ImageGenerationTransport<WireVendorBag> {
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
  it('returns urls for an asynchronous task completion', async () => {
    const query = vi.fn().mockResolvedValue({
      kind: 'completed',
      imageUrls: ['https://img/1.png', 'https://img/2.png']
    })
    const transport = taskTransport(query)
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual(['https://img/1.png', 'https://img/2.png'])
    expect(result.warnings).toEqual([])
    expect(result.response.modelId).toBe('m')
    expect(query).toHaveBeenCalledWith('task-1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('returns urls directly for an immediate completion', async () => {
    const transport: ImageGenerationTransport<WireVendorBag> = {
      submit: vi.fn().mockResolvedValue({ kind: 'completed', imageUrls: ['https://img/sync.png'] }),
      supportsInput: () => ({ files: false, mask: false }),
      task: { kind: 'unsupported' }
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual(['https://img/sync.png'])
  })

  it('rejects a terminal task failure without querying again', async () => {
    const query = vi.fn().mockResolvedValue({ kind: 'failed', message: 'Task failed' })
    const model = createImageGenerationModel('m', { provider: 'ppio', transport: taskTransport(query) })

    await expect(model.doGenerate(makeOptions())).rejects.toThrow('Task failed')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('throws AbortError before submit when the signal is already aborted', async () => {
    const transport = taskTransport(vi.fn())
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })
    const controller = new AbortController()
    controller.abort()

    await expect(model.doGenerate(makeOptions({ abortSignal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('cancels the remote task once when aborted during a query', async () => {
    const controller = new AbortController()
    const cancelRemote = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    const transport = taskTransport(query, { kind: 'supported', cancelRemote })
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    await expect(model.doGenerate(makeOptions({ abortSignal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(cancelRemote).toHaveBeenCalledTimes(1)
    expect(cancelRemote).toHaveBeenCalledWith('task-1', expect.objectContaining({ signal: undefined }))
  })

  it('forwards wire provider params and per-call headers to submit and query', async () => {
    const query = vi.fn().mockResolvedValue({ kind: 'completed', imageUrls: ['https://img/1.png'] })
    const transport = taskTransport(query)
    const submit = vi.fn(async (input: ImageGenerationSubmitInput<WireVendorBag>) => {
      expect(input.providerParams).toMatchObject({ num_inference_steps: 20 })
      expect(input.headers).toEqual({ 'x-request': 'one' })
      return { kind: 'submitted' as const, taskId: 'task-1' }
    })
    transport.submit = submit
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    const result = await model.doGenerate(
      makeOptions({
        providerOptions: { ppio: { num_inference_steps: 20 } } as never,
        headers: { 'x-request': 'one' }
      })
    )

    expect(result.images).toEqual(['https://img/1.png'])
    expect(query).toHaveBeenCalledWith('task-1', expect.objectContaining({ headers: { 'x-request': 'one' } }))
  })

  it('rejects a task submission from a transport without task capability', async () => {
    const transport: ImageGenerationTransport<WireVendorBag> = {
      submit: vi.fn().mockResolvedValue({ kind: 'submitted', taskId: 'task-1' }),
      supportsInput: () => ({ files: false, mask: false }),
      task: { kind: 'unsupported' }
    }
    const model = createImageGenerationModel('m', { provider: 'sync-provider', transport })

    await expect(model.doGenerate(makeOptions())).rejects.toThrow(/does not support task queries/)
  })
})
