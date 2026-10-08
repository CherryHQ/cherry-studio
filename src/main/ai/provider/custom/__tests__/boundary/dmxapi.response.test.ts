import { describe, expect, it, vi } from 'vitest'

import { resolveDmxapiImageBinding } from '../../dmxapi/dmxapiImageRouting'
import { createDmxapiTransport } from '../../dmxapi/dmxapiTransport'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

// https://doc.dmxapi.cn/img-qwen-image.html and https://doc.dmxapi.cn/wan2.6-t2i.html — retrieved 2026-09-09.
describe('DMXAPI malformed responses', () => {
  it.each([
    ...[undefined, 'RUNNING', 'FAILED', 'UNKNOWN', 42].map((task_status) => ({
      modelId: 'qwen-image',
      response: { extra: { output: { task_status, results: [{ url: 'https://images.example/not-completed.png' }] } } }
    })),
    { modelId: 'wan2.6-t2i', response: { output: [] } }
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

// https://doc.dmxapi.cn/doubao-seedream-5.0-lite-t2i.html and https://doc.dmxapi.cn/wan2.6-t2i.html — retrieved 2026-09-09.
describe('DMXAPI bound Responses contracts', () => {
  const markdown = '![Image 1](https://images.example/one.png)\n![Image 2](https://images.example/two.png)'
  const seedreamOutput = [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: markdown }] }]
  const wanOutput = [{ type: 'message', content: [{ type: 'image', text: 'https://images.example/one.png' }] }]

  async function submit(modelId: string, response: unknown) {
    const binding = resolveDmxapiImageBinding(modelId)
    if (binding.kind !== 'custom') throw new Error('Expected custom image protocol')
    return createDmxapiTransport({
      binding: binding.binding,
      apiKey: 'token',
      fetch: async () => Response.json(response)
    }).submit({
      modelId,
      prompt: 'a fox',
      n: 1,
      size: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerParams: {}
    })
  }

  it('extracts every documented Seedream markdown image after completion', async () => {
    await expect(submit('doubao-seedream-5.0-lite', { status: 'completed', output: seedreamOutput })).resolves.toEqual({
      kind: 'completed',
      imageUrls: ['https://images.example/one.png', 'https://images.example/two.png']
    })
  })

  it('reads the Wan image URL without inventing a Seedream status requirement', async () => {
    await expect(submit('wan2.6-t2i', { output: wanOutput })).resolves.toEqual({
      kind: 'completed',
      imageUrls: ['https://images.example/one.png']
    })
  })

  it.each([undefined, 'in_progress', 'failed', 'unknown', 42])(
    'rejects Seedream status %s even when output contains image links',
    async (status) => {
      await expect(submit('doubao-seedream-5.0-lite', { status, output: seedreamOutput })).rejects.toThrow()
    }
  )

  it.each([
    { name: 'output object', output: wanOutput[0] },
    { name: 'nested message alias', output: [{ type: 'message', message: wanOutput[0] }] },
    { name: 'missing output type', output: [{ content: wanOutput[0].content }] },
    { name: 'unknown output type', output: [{ type: 'unknown', content: wanOutput[0].content }] },
    {
      name: 'missing content type',
      output: [{ type: 'message', content: [{ text: 'https://images.example/one.png' }] }]
    },
    {
      name: 'unknown content type',
      output: [{ type: 'message', content: [{ type: 'unknown', text: 'https://images.example/one.png' }] }]
    },
    {
      name: 'image field alias',
      output: [{ type: 'message', content: [{ type: 'image', image: 'https://images.example/one.png' }] }]
    },
    {
      name: 'unrelated explanation link',
      output: [{ type: 'message', content: [{ type: 'image', text: 'Read https://docs.example/help for help' }] }]
    },
    { name: 'partially malformed result', output: [...wanOutput, { type: 'message', content: [{}] }] }
  ])('rejects Wan $name without dropping malformed entries', async ({ output }) => {
    await expect(submit('wan2.6-t2i', { output })).rejects.toThrow()
  })

  it.each([
    { name: 'Wan content in Seedream', output: wanOutput },
    { name: 'incomplete message', output: [{ ...seedreamOutput[0], status: 'in_progress' }] },
    {
      name: 'unrelated explanation link',
      output: [
        { ...seedreamOutput[0], content: [{ type: 'output_text', text: 'Read https://docs.example/help for help' }] }
      ]
    },
    {
      name: 'empty content beside a valid result',
      output: [...seedreamOutput, { type: 'message', status: 'completed', content: [] }]
    }
  ])('rejects Seedream $name', async ({ output }) => {
    await expect(submit('doubao-seedream-5.0-lite', { status: 'completed', output })).rejects.toThrow()
  })
})
