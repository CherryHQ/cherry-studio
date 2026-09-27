import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildDashScopeTransport } from '../dashscope/dashscopeProvider'
import { buildDmxapiTransport } from '../dmxapi/dmxapiProvider'
import type { ImageGenerationSubmitInput } from '../imageGenerationModel'
import { buildModelscopeTransport } from '../modelscope/modelscopeProvider'
import { createOvmsTransport } from '../ovms/ovmsTransport'
import { buildPpioTransport } from '../ppio/ppioProvider'

/** Global fetch skips the provider TLS session, so image hosts must use the injected fetch. */
describe('image transport provider fetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseInput = {
    n: 1,
    size: '1024x1024' as const,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerParams: {}
  }

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  async function expectProviderFetch(
    submit: (input: ImageGenerationSubmitInput) => Promise<unknown>,
    input: ImageGenerationSubmitInput,
    fetchImpl: ReturnType<typeof vi.fn>
  ) {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('global fetch bypassed provider TLS'))
    await submit(input)
    expect(fetchImpl).toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
  }

  it('sends PPIO image submit through the provider fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ task_id: 'task-1' }))
    const transport = buildPpioTransport({ apiKey: 'sk', baseURL: 'https://img.internal', fetch: fetchImpl })
    await expectProviderFetch(
      (input) => transport.submit(input),
      {
        ...baseInput,
        modelId: 'custom-image',
        prompt: 'a cat',
        modelDescriptor: { id: 'custom-image', endpoint: '/v3/custom-image' }
      },
      fetchImpl
    )
  })

  it('sends ModelScope image submit through the provider fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ task_id: 'task-1' }))
    const transport = buildModelscopeTransport({ apiKey: 'sk', imageBaseURL: 'https://img.internal', fetch: fetchImpl })
    await expectProviderFetch(
      (input) => transport.submit(input),
      { ...baseInput, modelId: 'Qwen-Image', prompt: 'a cat' },
      fetchImpl
    )
  })

  it('sends DMXAPI image submit through the provider fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ url: 'https://img.internal/a.png' }] }))
    const transport = buildDmxapiTransport({ apiKey: 'sk', baseURL: 'https://img.internal/v1', fetch: fetchImpl })
    await expectProviderFetch(
      (input) => transport.submit(input),
      { ...baseInput, modelId: 'sdxl-local', prompt: 'a cat' },
      fetchImpl
    )
  })

  it('sends OVMS image submit through the provider fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ url: 'https://img.internal/a.png' }] }))
    const transport = createOvmsTransport({ baseURL: 'https://img.internal', fetch: fetchImpl })
    await expectProviderFetch(
      (input) => transport.submit(input),
      { ...baseInput, modelId: 'sd', prompt: 'a cat' },
      fetchImpl
    )
  })

  it('sends DashScope image submit through the provider fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ output: { task_id: 'task-1' } }))
    const transport = buildDashScopeTransport({
      apiKey: 'sk',
      imageBaseURL: 'https://img.internal',
      fetch: fetchImpl
    })
    await expectProviderFetch(
      (input) => transport.submit(input),
      {
        ...baseInput,
        modelId: 'qwen-image',
        prompt: 'a cat',
        modelDescriptor: { id: 'qwen-image', endpoint: '/api/v1/services/aigc/text2image/image-synthesis' }
      },
      fetchImpl
    )
  })
})
