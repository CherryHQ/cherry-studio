import { describe, expect, it, vi } from 'vitest'

import { createPollingImageModel, type PollingSubmitInput, type PollingTransport } from '../pollingImageModel'

function makeOptions(overrides: Partial<Parameters<ReturnType<typeof createPollingImageModel>['doGenerate']>[0]> = {}) {
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
  } as Parameters<ReturnType<typeof createPollingImageModel>['doGenerate']>[0]
}

describe('createPollingImageModel.doGenerate', () => {
  it('returns urls for a terminal success (async submit → poll)', async () => {
    const transport: PollingTransport = {
      submit: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
      poll: vi.fn().mockResolvedValue(['https://img/1.png', 'https://img/2.png'])
    }
    const model = createPollingImageModel('m', { provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual(['https://img/1.png', 'https://img/2.png'])
    expect(result.warnings).toEqual([])
    expect(result.response.modelId).toBe('m')
    expect(transport.poll).toHaveBeenCalledWith('task-1', expect.objectContaining({ signal: undefined }))
  })

  it('returns urls directly for the synchronous (imageUrls) path without polling', async () => {
    const transport: PollingTransport = {
      submit: vi.fn().mockResolvedValue({ imageUrls: ['https://img/sync.png'] }),
      poll: vi.fn()
    }
    const model = createPollingImageModel('m', { provider: 'ppio', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual(['https://img/sync.png'])
    expect(transport.poll).not.toHaveBeenCalled()
  })

  it('rejects when poll rejects (terminal failure)', async () => {
    const transport: PollingTransport = {
      submit: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
      poll: vi.fn().mockRejectedValue(new Error('Task failed'))
    }
    const model = createPollingImageModel('m', { provider: 'ppio', transport })

    await expect(model.doGenerate(makeOptions())).rejects.toThrow('Task failed')
  })

  it('throws AbortError when the signal is already aborted', async () => {
    const transport: PollingTransport = {
      submit: vi.fn(),
      poll: vi.fn()
    }
    const model = createPollingImageModel('m', { provider: 'ppio', transport })
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
    const transport: PollingTransport = {
      submit: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
      poll: vi.fn().mockRejectedValue(abortError)
    }
    const model = createPollingImageModel('m', { provider: 'ppio', transport })

    await expect(model.doGenerate(makeOptions())).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('forwards the onProgress callback (by reference) and provider params to submit', async () => {
    const onProgress = vi.fn()
    let polledOnProgress: ((p: number) => void) | undefined
    const transport: PollingTransport = {
      submit: vi.fn(async (input: PollingSubmitInput) => {
        expect(input.providerParams).toMatchObject({ model: 'mid', onProgress })
        return { taskId: 'task-1' }
      }),
      poll: vi.fn(async (_taskId, opts) => {
        polledOnProgress = opts.onProgress
        opts.onProgress?.(42)
        return ['https://img/1.png']
      })
    }
    const model = createPollingImageModel('m', { provider: 'ppio', transport })

    await model.doGenerate(makeOptions({ providerOptions: { ppio: { model: 'mid', onProgress } } as never }))

    expect(polledOnProgress).toBe(onProgress)
    expect(onProgress).toHaveBeenCalledWith(42)
  })

  it('returns empty images when submit yields neither taskId nor imageUrls', async () => {
    const transport: PollingTransport = {
      submit: vi.fn().mockResolvedValue({}),
      poll: vi.fn()
    }
    const model = createPollingImageModel('m', { provider: 'tokenflux', transport })

    const result = await model.doGenerate(makeOptions())

    expect(result.images).toEqual([])
    expect(transport.poll).not.toHaveBeenCalled()
  })
})
