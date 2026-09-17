import { describe, expect, it, vi } from 'vitest'

import { applySeed, createComfyuiTransport, listWorkflows } from '../comfyuiTransport'
import type { ApiPromptNode, ObjectInfo } from '../uiToApiPrompt'

const objectInfo: ObjectInfo = {
  CLIPTextEncode: { input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } } },
  KSampler: {
    input: {
      required: {
        model: ['MODEL'],
        seed: ['INT', { default: 0 }],
        steps: ['INT', { default: 20 }],
        cfg: ['FLOAT', { default: 8 }],
        sampler_name: [['euler'], {}],
        scheduler: [['normal'], {}],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
        denoise: ['FLOAT', { default: 1 }]
      }
    }
  }
}

/** A minimal UI workflow whose prompt target is the CLIPTextEncode. */
const workflow = {
  nodes: [
    { id: 1, type: 'CLIPTextEncode', widgets_values: ['hi'] },
    {
      id: 2,
      type: 'KSampler',
      inputs: [{ name: 'positive', link: 3 }],
      widgets_values: [0, 20, 8, 'euler', 'normal']
    }
  ],
  links: [[3, 1, 0, 2, 6]]
}

const respond = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

describe('ComfyuiTransport', () => {
  it('routes every request through the configured fetch and headers', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'X-Test': '1' })
      const url = String(input)
      if (url.includes('/object_info')) return respond(objectInfo)
      if (url.includes('/userdata/')) return respond(workflow)
      return respond({ prompt_id: 'pid-1' })
    })
    const transport = createComfyuiTransport({
      baseURL: 'http://localhost:8188',
      headers: { 'X-Test': '1' },
      fetch: doFetch
    })

    const result = await transport.submit({
      modelId: 'flow',
      prompt: 'a cat',
      n: 1,
      size: undefined,
      seed: 42,
      files: [],
      mask: undefined,
      providerParams: {}
    })

    expect(result.taskId).toBe('pid-1')
    // Every request — workflow read, object_info, prompt POST — carries the
    // configured headers (asserted inside the mock).
    const [url, init] = doFetch.mock.calls[doFetch.mock.calls.length - 1]
    expect(String(url)).toBe('http://localhost:8188/prompt')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body.prompt['1'].inputs.text).toBe('a cat')
    expect(body.prompt['2'].inputs.seed).toBe(42)
  })
})

describe('listWorkflows', () => {
  it('passes configured headers to the userdata listing', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8188/v2/userdata?path=workflows')
      expect(init?.headers).toEqual({ 'X-Test': '1' })
      return respond([{ name: 'a.json', type: 'file' }])
    })

    const workflows = await listWorkflows('http://localhost:8188', undefined, {
      headers: { 'X-Test': '1' },
      fetch: doFetch
    })

    expect(workflows).toEqual(['a'])
  })
})

describe('cancel', () => {
  const transportWithQueue = () => {
    const postBodies: unknown[] = []
    const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/queue')) {
        if (init?.method === 'POST') postBodies.push(init.body)
        return respond({ queue_running: [['running-id']], queue_pending: [['queued-id']] })
      }
      return new Response('', { status: 200 })
    })
    const transport = createComfyuiTransport({ baseURL: 'http://localhost:8188', fetch: doFetch })
    return { transport, doFetch, postBodies }
  }

  it('interrupts only the generation that is running', async () => {
    const { transport, doFetch } = transportWithQueue()

    await transport.cancel('running-id')

    const urls = doFetch.mock.calls.map(([input]) => String(input))
    expect(urls).toContain('http://localhost:8188/interrupt')
  })

  it('deletes a queued generation instead of interrupting', async () => {
    const { transport, doFetch, postBodies } = transportWithQueue()

    await transport.cancel('queued-id')

    expect(doFetch.mock.calls.map(([input]) => String(input))).not.toContain('http://localhost:8188/interrupt')
    expect(JSON.parse(postBodies[0] as string)).toEqual({ delete: ['queued-id'] })
  })

  it('does nothing for a finished generation', async () => {
    const { transport, doFetch } = transportWithQueue()

    await transport.cancel('gone-id')

    expect(doFetch.mock.calls.map(([input]) => String(input))).toEqual(['http://localhost:8188/queue'])
  })
})

describe('applySeed', () => {
  it('writes noise_seed for advanced samplers', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 7 }, _meta: { title: 'x' } }
    }

    applySeed(graph, 42, '1')

    expect(graph['1'].inputs.noise_seed).toBe(42)
  })

  it('prefers seed when a sampler exposes both', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'CustomSampler', inputs: { seed: 7, noise_seed: 8 }, _meta: { title: 'x' } }
    }

    applySeed(graph, 42, '1')

    expect(graph['1'].inputs.seed).toBe(42)
    expect(graph['1'].inputs.noise_seed).toBe(8)
  })

  it('falls back to any noise_seed node when the sampler has neither', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 7 }, _meta: { title: 'x' } }
    }

    applySeed(graph, 42)

    expect(graph['1'].inputs.noise_seed).toBe(42)
  })

  it('writes a linked seed at its source node instead of severing the link', () => {
    const graph: Record<string, ApiPromptNode> = {
      '1': { class_type: 'Seed', inputs: { seed: 7 }, _meta: { title: 'source' } },
      '2': { class_type: 'KSampler', inputs: { seed: ['1', 0] }, _meta: { title: 'sampler' } }
    }

    applySeed(graph, 42, '2')

    expect(graph['2'].inputs.seed).toEqual(['1', 0])
    expect(graph['1'].inputs.seed).toBe(42)
  })
})
