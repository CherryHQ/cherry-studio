import { describe, expect, it, vi } from 'vitest'

import {
  createImageGenerationModel,
  type ImageGenerationSubmitInput,
  type ImageGenerationTransport
} from '../imageGenerationModel'

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

describe('createImageGenerationModel.doGenerate', () => {
  it('returns urls for a terminal success (async submit → poll)', async () => {
    const transport: ImageGenerationTransport = {
      submit: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
      poll: vi.fn().mockResolvedValue(['https://img/1.png', 'https://img/2.png'])
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual(['https://img/1.png', 'https://img/2.png'])
    expect(result.warnings).toEqual([])
    expect(result.response.modelId).toBe('m')
    expect(transport.poll).toHaveBeenCalledWith('task-1', expect.objectContaining({ signal: undefined }))
  })

  it('returns urls directly for the synchronous (imageUrls) path without requiring polling', async () => {
    const transport: ImageGenerationTransport = {
      submit: vi.fn().mockResolvedValue({ imageUrls: ['https://img/sync.png'] })
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual(['https://img/sync.png'])
  })

  it('rejects when poll rejects (terminal failure)', async () => {
    const transport: ImageGenerationTransport = {
      submit: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
      poll: vi.fn().mockRejectedValue(new Error('Task failed'))
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    await expect(model.doGenerate(makeOptions())).rejects.toThrow('Task failed')
  })

  it('throws AbortError when the signal is already aborted', async () => {
    const transport: ImageGenerationTransport = {
      submit: vi.fn(),
      poll: vi.fn()
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })
    const controller = new AbortController()
    controller.abort()

    await expect(model.doGenerate(makeOptions({ abortSignal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('propagates an AbortError raised mid-poll', async () => {
    const abortError = new Error('Task polling aborted')
    abortError.name = 'AbortError'
    const transport: ImageGenerationTransport = {
      submit: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
      poll: vi.fn().mockRejectedValue(abortError)
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    await expect(model.doGenerate(makeOptions())).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('cancels the remote async task when aborted after submit', async () => {
    const controller = new AbortController()
    const cancel = vi.fn().mockResolvedValue(undefined)
    const transport: ImageGenerationTransport = {
      submit: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
      poll: vi.fn(
        async (_taskId, opts) =>
          new Promise<string[]>((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => {
              const error = new Error('Task polling aborted')
              error.name = 'AbortError'
              reject(error)
            })
          })
      ),
      cancel
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    const promise = model.doGenerate(makeOptions({ abortSignal: controller.signal }))
    await vi.waitFor(() => expect(transport.poll).toHaveBeenCalled())
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledWith('task-1')
  })

  it('forwards the onProgress callback (by reference) and provider params to submit', async () => {
    const onProgress = vi.fn()
    let polledOnProgress: ((p: number) => void) | undefined
    const transport: ImageGenerationTransport = {
      submit: vi.fn(async (input: ImageGenerationSubmitInput) => {
        expect(input.providerParams).toMatchObject({ model: 'mid', onProgress })
        return { taskId: 'task-1' }
      }),
      poll: vi.fn(async (_taskId, opts) => {
        polledOnProgress = opts.onProgress
        opts.onProgress?.(42)
        return ['https://img/1.png']
      })
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    await model.doGenerate(makeOptions({ providerOptions: { ppio: { model: 'mid', onProgress } } as never }))

    expect(polledOnProgress).toBe(onProgress)
    expect(onProgress).toHaveBeenCalledWith(42)
  })

  it('returns empty images when submit yields neither taskId nor imageUrls', async () => {
    const transport: ImageGenerationTransport = {
      submit: vi.fn().mockResolvedValue({})
    }
    const model = createImageGenerationModel('m', { provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual([])
  })

  it('rejects when an async task id is returned by a non-polling transport', async () => {
    const transport: ImageGenerationTransport = {
      submit: vi.fn().mockResolvedValue({ taskId: 'task-1' })
    }
    const model = createImageGenerationModel('m', { provider: 'sync-provider', transport })

    await expect(model.doGenerate(makeOptions())).rejects.toThrow(
      'sync-provider returned a task id but does not implement polling'
    )
  })
})
