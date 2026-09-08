import { describe, expect, it, vi } from 'vitest'

import { resolveDmxapiImageBinding } from '../../dmxapi/dmxapiImageRouting'
import { createDmxapiTransport } from '../../dmxapi/dmxapiTransport'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

// https://doc.dmxapi.cn/img-qwen-image.html and https://doc.dmxapi.cn/wan2.6-t2i.html — retrieved 2026-09-09.
describe('DMXAPI malformed responses', () => {
  it.each([
    { modelId: 'qwen-image', response: {} },
    { modelId: 'qwen-image', response: { extra: { output: { results: [] } } } },
    { modelId: 'qwen-image', response: { extra: { output: { results: [{ url: '' }] } } } },
    { modelId: 'qwen-image', response: { extra: { output: { results: [{ url: 42 }] } } } },
    { modelId: 'wan2.6-t2i', response: { output: [] } },
    { modelId: 'wan2.6-t2i', response: { output: [{ content: [{ text: 42 }] }] } },
    { modelId: 'wan2.6-t2i', response: { output: [{ content: [{ text: 'no generated image' }] }] } },
    { modelId: 'doubao-seedream-5.0-lite', response: { output: [{ content: [{ image: '' }] }] } }
  ])('rejects $modelId response $response instead of returning empty success', async ({ modelId, response }) => {
    const binding = resolveDmxapiImageBinding(modelId)
    if (binding.kind !== 'custom') throw new Error('Expected a custom binding')
    const transport = createDmxapiTransport({
      binding: binding.binding,
      apiKey: 'token',
      fetch: async () => Response.json(response)
    })
    await expect(
      transport.submit({
        modelId,
        prompt: 'a fox',
        n: 1,
        size: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerParams: {}
      })
    ).rejects.toThrow()
  })
})
