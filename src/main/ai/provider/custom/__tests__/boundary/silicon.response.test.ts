import { describe, expect, it } from 'vitest'

import { createSiliconTransport } from '../../silicon/siliconTransport'

const input = {
  modelId: 'Qwen/Qwen-Image',
  prompt: 'a fox',
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
}

// https://api-docs.siliconflow.cn/docs/api/images-generations-post — retrieved 2026-09-09.
describe('SiliconFlow response boundary', () => {
  function transport(body: unknown) {
    return createSiliconTransport({
      url: ({ path }) => `https://api.siliconflow.cn/v1${path}`,
      headers: () => ({}),
      fetch: async () => Response.json(body)
    })
  }

  it('returns every documented images[].url result', async () => {
    const urls = ['https://images.example/one.png', 'https://images.example/two.png']
    expect(await transport({ images: urls.map((url) => ({ url })) }).submit(input)).toEqual({
      kind: 'completed',
      imageUrls: urls
    })
  })

  it.each([
    {},
    { data: [{ url: 'https://images.example/wrong-field.png' }] },
    { images: [{ b64_json: 'AQID' }] },
    { images: [] },
    { images: [{}] },
    { images: [{ url: '' }] },
    { images: [{ url: 42 }] },
    { images: [{ url: 'https://images.example/valid.png' }, {}] }
  ])('rejects malformed results without silently retaining a valid subset: %j', async (body) => {
    await expect(transport(body).submit(input)).rejects.toThrow()
  })
})
