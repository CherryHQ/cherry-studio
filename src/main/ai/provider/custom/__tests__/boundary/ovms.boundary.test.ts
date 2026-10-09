import { describe, expect, it } from 'vitest'

import { createOvmsProvider } from '../../ovms/ovmsProvider'

// Fields: https://docs.openvino.ai/2026/model-server/ovms_docs_rest_api_image_generation.html — retrieved 2026-09-09.
// The unversioned path is deliberately retained; this test does not validate the newer /v3 endpoint.
describe('OVMS canonical SDK boundary', () => {
  it('delivers native size/zero seed and canonical steps using the injected fetch and request headers', async () => {
    const requests: Request[] = []
    const provider = createOvmsProvider({
      baseURL: 'http://localhost:8000/v3',
      imageBaseURL: 'http://image.example',
      apiKey: 'unused',
      headers: { 'x-provider': 'cherry' },
      fetch: async (url, init) => {
        requests.push(new Request(url, init))
        return Response.json({ data: [{ b64_json: 'AQID' }] })
      }
    })
    const result = await provider.imageModel('OpenVINO/stable-diffusion-v1-5').doGenerate({
      prompt: 'a fox',
      n: 1,
      size: '768x768',
      seed: 0,
      aspectRatio: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: { ovms: { numInferenceSteps: 8 } },
      headers: { 'x-call': 'once' }
    })
    expect(requests[0].url).toBe('http://image.example/images/generations')
    expect(await requests[0].json()).toEqual({
      model: 'OpenVINO/stable-diffusion-v1-5',
      prompt: 'a fox',
      size: '768x768',
      num_inference_steps: 8,
      rng_seed: 0
    })
    expect(requests[0].headers.get('authorization')).toBeNull()
    expect(requests[0].headers.get('x-provider')).toBe('cherry')
    expect(requests[0].headers.get('x-call')).toBe('once')
    expect(result.images).toEqual(['data:image/png;base64,AQID'])
  })
})
