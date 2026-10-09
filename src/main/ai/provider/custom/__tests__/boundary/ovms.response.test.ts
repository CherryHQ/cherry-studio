import { describe, expect, it } from 'vitest'

import { createOvmsTransport } from '../../ovms/ovmsTransport'

const input = {
  modelId: 'OpenVINO/stable-diffusion-v1-5',
  prompt: 'a fox',
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
}

// https://docs.openvino.ai/2026/model-server/ovms_docs_rest_api_image_generation.html — retrieved 2026-09-09.
describe('OVMS response boundary', () => {
  it('returns every documented base64 image', async () => {
    const transport = createOvmsTransport({
      fetch: async () => Response.json({ data: [{ b64_json: 'AQID' }, { b64_json: 'BAUG' }] })
    })
    expect(await transport.submit(input)).toEqual({
      kind: 'completed',
      imageUrls: ['data:image/png;base64,AQID', 'data:image/png;base64,BAUG']
    })
  })

  it.each([
    {},
    { data: [] },
    { data: [{}] },
    { data: [{ b64_json: '' }] },
    { data: [{ b64_json: 42 }] },
    { data: [{ url: 'https://images.example/not-supported.png' }] },
    { data: [{ b64_json: 'AQID' }, {}] }
  ])('rejects missing or malformed image results: %j', async (body) => {
    const transport = createOvmsTransport({ fetch: async () => Response.json(body) })
    await expect(transport.submit(input)).rejects.toThrow()
  })
})
