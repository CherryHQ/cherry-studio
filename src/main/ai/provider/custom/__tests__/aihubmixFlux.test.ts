import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createAihubmixFluxTransport } from '../aihubmix/aihubmixFlux'

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

  it('extracts the documented taskId and sends the BFL body', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ output: [{ taskId: 'task-1' }] }), { status: 200 }))
    const transport = createAihubmixFluxTransport({
      ...settings,
      headers: { 'APP-Code': 'code' },
      fetch
    })

    const result = await transport.submit({
      ...baseInput,
      prompt: 'a fox',
      seed: 42,
      aspectRatio: '16:9',
      providerParams: { safetyTolerance: 3 },
      headers: { 'x-request': 'one' }
    })

    // Contract source: https://docs.aihubmix.com/cn/api/Image-Gen
    // Retrieved 2026-07-27.
    expect(result).toEqual({ kind: 'submitted', taskId: 'task-1' })
    expect(fetch.mock.calls[0][0]).toBe('https://aihubmix.test/v1/models/bfl/flux-2-pro/predictions')
    const init = fetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      input: {
        prompt: 'a fox',
        aspect_ratio: '16:9',
        seed: 42,
        safety_tolerance: 3
      }
    })
    expect(Object.fromEntries(new Headers(init.headers).entries())).toMatchObject({
      authorization: 'Bearer token',
      'app-code': 'code',
      'x-request': 'one'
    })
  })

  it('rejects undocumented task-id spellings and missing task ids', async () => {
    for (const body of [{ output: [{ id: 'legacy-id' }] }, { output: [{}] }]) {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
      const transport = createAihubmixFluxTransport({ ...settings, fetch })
      await expect(transport.submit({ ...baseInput, prompt: 'a fox' })).rejects.toThrow('Invalid JSON response')
    }
  })

  it('preserves structured API errors from submit', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch })

    const error = await transport.submit({ ...baseInput, prompt: 'a fox' }).catch((cause) => cause)
    expect(APICallError.isInstance(error)).toBe(true)
    expect(error).toMatchObject({ message: 'bad request', statusCode: 400, isRetryable: false })
  })

  it.each([
    [{ status: 'Pending' }, { kind: 'pending' }],
    [
      { status: 'Ready', result: { sample: 'https://img/a.png' } },
      { kind: 'completed', imageUrls: ['https://img/a.png'] }
    ],
    [
      { status: 'Ready', result: { samples: ['https://img/a.png', 'https://img/b.png'] } },
      { kind: 'completed', imageUrls: ['https://img/a.png', 'https://img/b.png'] }
    ],
    [
      { status: 'Content Moderated', detail: 'blocked' },
      { kind: 'failed', message: 'blocked' }
    ]
  ])('normalizes one task response %#', async (responseBody, expected) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }))
    const transport = createAihubmixFluxTransport({ ...settings, fetch })
    if (transport.task.kind !== 'supported') throw new Error('expected task transport')

    await expect(
      transport.task.query('task-1', {
        signal: new AbortController().signal,
        modelDescriptor: undefined,
        headers: undefined,
        providerParams: {}
      })
    ).resolves.toEqual(expected)
  })

  it('rejects Ready without a sample and unknown statuses', async () => {
    for (const body of [{ status: 'Ready', result: {} }, { status: 'Something New' }]) {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
      const transport = createAihubmixFluxTransport({ ...settings, fetch })
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')

      await expect(
        transport.task.query('task-1', {
          signal: new AbortController().signal,
          modelDescriptor: undefined,
          headers: undefined,
          providerParams: {}
        })
      ).rejects.toThrow()
    }
  })
})
