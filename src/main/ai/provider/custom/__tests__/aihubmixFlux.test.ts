import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAihubmixFluxTransport } from '../aihubmix/aihubmixFlux'

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))

/**
 * Covers the AiHubMix BFL async FLUX transport: submit task-id extraction and
 * body shape, poll status handling (Ready / terminal / no-sample), the bounded
 * transient-retry behavior, abort, and the overall task timeout.
 */
describe('AihubmixFluxTransport', () => {
  const settings = { apiRoot: 'https://aihubmix.test', apiKey: 'token' }

  const baseInput = {
    modelId: 'flux-2-pro',
    prompt: undefined,
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerParams: {}
  } as const

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── submit ──

  it('extracts taskId from { output: [{ taskId }] } and sends prompt/aspect_ratio/seed/safety_tolerance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ output: [{ taskId: 'task-1' }] }), { status: 200 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const result = await transport.submit({
      ...baseInput,
      modelId: 'flux-2-pro',
      prompt: 'a fox',
      seed: 42,
      providerParams: { aspect_ratio: '16:9', safetyTolerance: 3 }
    })

    expect(result).toEqual({ taskId: 'task-1' })

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://aihubmix.test/v1/models/bfl/flux-2-pro/predictions')
    const init = call[1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      input: {
        prompt: 'a fox',
        aspect_ratio: '16:9',
        seed: 42,
        safety_tolerance: 3
      }
    })
  })

  it('falls back to output[0].id when taskId is absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ output: [{ id: 'task-id-fallback' }] }), { status: 200 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const result = await transport.submit({ ...baseInput, prompt: 'a fox' })

    expect(result).toEqual({ taskId: 'task-id-fallback' })
  })

  it('throws REMOTE_ERROR when submit returns no taskId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [{}] }), { status: 200 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    await expect(transport.submit({ ...baseInput, prompt: 'a fox' })).rejects.toMatchObject({
      name: 'PaintingGenerateError',
      code: 'REMOTE_ERROR',
      message: 'No taskId returned from FLUX submit'
    })
  })

  it('throws REMOTE_ERROR with the parsed message on a non-ok submit response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    await expect(transport.submit({ ...baseInput, prompt: 'a fox' })).rejects.toMatchObject({
      name: 'PaintingGenerateError',
      code: 'REMOTE_ERROR',
      message: 'bad request'
    })
  })

  // ── poll ──

  it('polls Pending → Ready and returns [result.sample]', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Pending' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'Ready', result: { sample: 'https://img/a.png' } }), { status: 200 })
      )
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise

    expect(result).toEqual(['https://img/a.png'])
    expect(fetchMock.mock.calls[0][0]).toBe('https://aihubmix.test/v1/tasks/task-1')
  })

  it('returns the result.samples array when sample is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'Ready', result: { samples: ['https://img/a.png', 'https://img/b.png'] } }),
        {
          status: 200
        }
      )
    )
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(result).toEqual(['https://img/a.png', 'https://img/b.png'])
  })

  it('throws immediately on a terminal Error status without retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'Error', detail: 'render failed' }), { status: 200 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(3000)
    const error = await promise

    expect(error).toMatchObject({ name: 'PaintingGenerateError', code: 'REMOTE_ERROR', message: 'render failed' })
    // Terminal status → exactly one fetch, no transient-retry storm.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on a Content Moderated status without retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'Content Moderated' }), { status: 200 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(3000)
    const error = await promise

    expect(error).toMatchObject({ name: 'PaintingGenerateError', code: 'REMOTE_ERROR', message: 'Content Moderated' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws REMOTE_ERROR when Ready arrives without a sample URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'Ready', result: {} }), { status: 200 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(3000)
    const error = await promise

    expect(error).toMatchObject({
      name: 'PaintingGenerateError',
      code: 'REMOTE_ERROR',
      message: 'FLUX Ready without a sample URL'
    })
  })

  // ── transient retry (my fix) ──

  it('retries a transient non-ok poll response and then succeeds on Ready', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'upstream 500' } }), { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'Ready', result: { sample: 'https://img/ok.png' } }), { status: 200 })
      )
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise

    expect(result).toEqual(['https://img/ok.png'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a thrown fetch error and then succeeds on Ready', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network glitch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'Ready', result: { sample: 'https://img/ok.png' } }), { status: 200 })
      )
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise

    expect(result).toEqual(['https://img/ok.png'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces REMOTE_ERROR after exceeding the transient-retry ceiling (10 consecutive failures)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('persistent glitch'))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(60000)
    const error = await promise

    expect(error).toMatchObject({ name: 'PaintingGenerateError', code: 'REMOTE_ERROR', message: 'persistent glitch' })
    // 10 retries tolerated, the 11th consecutive failure surfaces (> ceiling).
    expect(fetchMock).toHaveBeenCalledTimes(11)
  })

  // ── timeout ──

  it('throws a timeout REMOTE_ERROR once MAX_WAIT_MS elapses while still Pending', async () => {
    // Return a fresh Response per call — a single Response body can only be
    // read once, and this poll loop runs ~150 iterations before timing out.
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ status: 'Pending' }), { status: 200 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const promise = transport.poll('task-1', {}).catch((e) => e)
    // Advance past MAX_WAIT_MS (5 min) plus a poll interval so the next
    // iteration's top-of-loop timeout check fires.
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 2_000)
    const error = await promise

    expect(error).toMatchObject({ name: 'PaintingGenerateError', code: 'REMOTE_ERROR' })
    expect((error as Error).message).toContain('timed out')
  })

  // ── abort ──

  it('throws an AbortError when the signal is already aborted', async () => {
    const fetchMock = vi.fn()
    const transport = createAihubmixFluxTransport({ ...settings, fetch: fetchMock as never })

    const controller = new AbortController()
    controller.abort()

    const promise = transport.poll('task-1', { signal: controller.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    const error = await promise

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
