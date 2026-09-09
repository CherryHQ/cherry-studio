import { describe, expect, it, vi } from 'vitest'

import { registryImageDescriptor } from '../../../__tests__/imageCatalogFixtures'
import { resolveDmxapiImageBinding } from '../../dmxapi/dmxapiImageRouting'
import { buildDmxapiTransport } from '../../dmxapi/dmxapiProvider'
import type { ImageGenerationSubmitInput } from '../../imageTransport'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

const cases = [
  // https://doc.dmxapi.cn/img-qwen-image.html — retrieved 2026-09-09.
  {
    modelId: 'qwen-image',
    path: '/v1/images/generations',
    response: { extra: { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://image.example/qwen.png' }] } } },
    urls: ['https://image.example/qwen.png'],
    body: { model: 'qwen-image', prompt: 'a fox', n: 1 }
  },
  // https://doc.dmxapi.cn/doubao-seedream-5.0-lite-t2i.html — retrieved 2026-09-09.
  {
    modelId: 'doubao-seedream-5.0-lite',
    path: '/v1/responses',
    response: {
      status: 'completed',
      output: [
        {
          type: 'message',
          status: 'completed',
          content: [{ type: 'output_text', text: '![Image 1](https://image.example/seedream.png)' }]
        }
      ]
    },
    urls: ['https://image.example/seedream.png'],
    body: { model: 'doubao-seedream-5.0-lite', input: 'a fox', stream: false }
  },
  // https://doc.dmxapi.cn/wan2.6-t2i.html — retrieved 2026-09-09.
  {
    modelId: 'wan2.6-t2i',
    path: '/v1/responses',
    response: { output: [{ type: 'message', content: [{ type: 'image', text: 'https://image.example/wan.png' }] }] },
    urls: ['https://image.example/wan.png'],
    body: { model: 'wan2.6-t2i', input: { messages: [{ role: 'user', content: [{ text: 'a fox' }] }] } }
  }
]

describe('DMXAPI custom protocol boundary', () => {
  it.each(cases)('$modelId preserves the declared request and extracts documented results', async (entry) => {
    const descriptor = registryImageDescriptor('dmxapi', entry.modelId)
    const binding = resolveDmxapiImageBinding(descriptor.id)
    if (binding.kind !== 'custom') throw new Error('Expected a custom catalog protocol')
    const requests: Request[] = []
    const transport = buildDmxapiTransport(
      {
        apiKey: 'token',
        baseURL: 'https://gateway.example/v1',
        headers: { 'x-provider': 'cherry' },
        fetch: async (url, init) => {
          requests.push(new Request(url, init))
          return Response.json(entry.response)
        }
      },
      binding.binding
    )
    const result = await transport.submit({
      modelId: 'unrelated-model',
      modelDescriptor: descriptor,
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerParams: {},
      headers: { 'x-call': 'once' }
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe(`https://gateway.example${entry.path}`)
    expect(requests[0].method).toBe('POST')
    expect(await requests[0].json()).toEqual(entry.body)
    expect(requests[0].headers.get('authorization')).toBe('Bearer token')
    expect(requests[0].headers.get('x-provider')).toBe('cherry')
    expect(requests[0].headers.get('x-call')).toBe('once')
    expect(result).toEqual({ kind: 'completed', imageUrls: entry.urls })
  })

  // https://doc.dmxapi.cn/wan2.6-t2i.html — retrieved 2026-09-09.
  it('delivers canonical explicit false and zero without changing native size semantics', async () => {
    const binding = resolveDmxapiImageBinding('wan2.6-t2i')
    if (binding.kind !== 'custom') throw new Error('Expected Wan binding')
    const requests: Request[] = []
    const transport = buildDmxapiTransport(
      {
        apiKey: 'token',
        baseURL: 'https://gateway.example/v1',
        fetch: async (url, init) => {
          requests.push(new Request(url, init))
          return Response.json({
            output: [{ type: 'message', content: [{ type: 'image', text: 'https://image.example/wan.png' }] }]
          })
        }
      },
      binding.binding
    )
    const input = {
      modelId: 'wan2.6-t2i',
      prompt: 'a fox',
      n: 2,
      size: '1280x1280',
      seed: 0,
      files: undefined,
      mask: undefined,
      providerParams: { promptExtend: false, addWatermark: false, negativePrompt: 'blur' }
    } satisfies ImageGenerationSubmitInput
    await transport.submit(input)
    expect(await requests[0].json()).toEqual({
      model: 'wan2.6-t2i',
      input: { messages: [{ role: 'user', content: [{ text: 'a fox' }] }] },
      parameters: { n: 2, size: '1280*1280', seed: 0, prompt_extend: false, watermark: false, negative_prompt: 'blur' }
    })
  })
})
