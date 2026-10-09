import type { FetchFunction } from '@ai-sdk/provider-utils'
import { describe, expect, it, vi } from 'vitest'

import { createDmxapiTransport } from '../dmxapi/dmxapiTransport'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

const input = {
  modelId: 'qwen-image',
  prompt: 'a fox',
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
}
const transport = (fetch: FetchFunction) =>
  createDmxapiTransport({ binding: { family: 'openai-flat-async', modelId: 'qwen-image' }, apiKey: 'token', fetch })

describe('DMXAPI application error and abort contract', () => {
  it.each([
    [401, 'REQ_ERROR_TOKEN'],
    [403, 'REQ_ERROR_NO_BALANCE']
  ] as const)('keeps status %s business mapping', async (status, code) => {
    await expect(transport(async () => new Response('', { status })).submit(input)).rejects.toMatchObject({
      name: 'PaintingGenerateError',
      code
    })
  })

  it.each([JSON.stringify({ error: { message: 'rate limited' } }), 'rate limited'])(
    'retains JSON/plain-text error details',
    async (body) => {
      await expect(transport(async () => new Response(body, { status: 429 })).submit(input)).rejects.toMatchObject({
        name: 'PaintingGenerateError',
        code: 'REMOTE_ERROR',
        message: 'rate limited'
      })
    }
  )

  it('aborts the injected HTTP request without converting cancellation into a vendor error', async () => {
    const controller = new AbortController()
    let started = false
    const pending = transport(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          started = true
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true
          })
        })
    ).submit({ ...input, signal: controller.signal })
    await vi.waitFor(() => expect(started).toBe(true))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
