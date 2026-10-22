import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDashScopeTransport } from '../dashscope/dashscopeTransport'
import { DEFAULT_IMAGE_REQUEST_TIMEOUT_MS, type ImageGenerationSubmitInput } from '../imageGenerationModel'

/**
 * Submit-timeout contract for the sync path: DashScope generates inside the
 * submit POST for `isSync` models, so this bound *is* the generation budget.
 */
const descriptor = {
  id: 'qwen-image',
  endpoint: '/api/v1/services/aigc/text2image/image-synthesis',
  isSync: true
}

const baseInput = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput>

/** A request that only ever settles when its abort signal fires. */
const neverSettles: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    })
  })

describe('DashScope submit timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('bounds submit with the 10-minute default when the request carries no override', async () => {
    const transport = createDashScopeTransport({ apiKey: 'token' })
    vi.spyOn(globalThis, 'fetch').mockImplementation(neverSettles)

    const promise = transport
      .submit({ ...baseInput, modelId: 'qwen-image', prompt: 'a fox', modelDescriptor: descriptor })
      .catch((error) => error)

    await vi.advanceTimersByTimeAsync(DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)

    const error = await promise
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      `DashScope API request timeout after ${DEFAULT_IMAGE_REQUEST_TIMEOUT_MS / 1000}s`
    )
  })

  it('honors the per-request timeout instead of the default', async () => {
    const transport = createDashScopeTransport({ apiKey: 'token' })
    vi.spyOn(globalThis, 'fetch').mockImplementation(neverSettles)

    const promise = transport
      .submit({
        ...baseInput,
        modelId: 'qwen-image',
        prompt: 'a fox',
        modelDescriptor: descriptor,
        requestTimeoutMs: 15_000
      })
      .catch((error) => error)

    await vi.advanceTimersByTimeAsync(15_000)

    // Racing a sentinel keeps the pre-fix behaviour (override ignored → still
    // pending at 15s) a fast assertion failure instead of a hung test.
    const outcome = await Promise.race([promise, Promise.resolve('still-pending' as const)])
    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toBe('DashScope API request timeout after 15s')
  })
})
