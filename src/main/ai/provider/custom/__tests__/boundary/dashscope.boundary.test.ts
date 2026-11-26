import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { ProviderModelListSchema } from '@cherrystudio/provider-registry'
import type { ImageGenerationMode } from '@shared/data/types/model'

import { createDashScopeProvider } from '../../dashscope/dashscopeProvider'
import { createDashScopeTransport } from '../../dashscope/dashscopeTransport'
import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { captureImageRequest } from './captureRequest'

/**
 * DashScope request boundary — one body family per model id, POSTed to the
 * descriptor endpoint. Covers text2image (flat input), chat-like (messages[]),
 * wanx-v1 (ref_image), wan2.5 i2i (images[]), qwen-mt (image_url + langs) and
 * wanx2.1-imageedit (function + base_image_url). size is converted `x`→`*`.
 */
const host = 'https://dashscope.aliyuncs.com'
const file = (bytes: number[]) =>
  [{ mediaType: 'image/png', data: new Uint8Array(bytes) }] as ImageGenerationSubmitInput['files']

const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined
} satisfies Partial<ImageGenerationSubmitInput>

const descriptor = (id: string, mode: ImageGenerationMode) => ({
  id,
  endpoint: '/api/v1/services/aigc/image',
  isSync: false,
  mode
})

const messagePart = z.union([z.strictObject({ text: z.string() }), z.strictObject({ image: z.string() })])

interface Case {
  name: string
  input: ImageGenerationSubmitInput
  schema: z.ZodTypeAny
}

const CASES: Case[] = [
  {
    name: 'text2image (qwen-image) → input.prompt + parameters.size/seed',
    input: {
      ...base,
      modelId: 'qwen-image',
      prompt: 'a fox',
      size: '1024x1024',
      seed: 42,
      modelDescriptor: descriptor('qwen-image', 'generate'),
      providerParams: {}
    },
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ prompt: z.string() }),
      parameters: z.strictObject({ size: z.string(), seed: z.number().int() })
    })
  },
  {
    name: 'chat-like (qwen-image-edit) → messages[] with inlined image',
    input: {
      ...base,
      modelId: 'qwen-image-edit',
      prompt: 'a fox',
      files: file([1, 2, 3]),
      modelDescriptor: descriptor('qwen-image-edit', 'edit'),
      providerParams: {}
    },
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({
        messages: z.array(z.strictObject({ role: z.literal('user'), content: z.array(messagePart) }))
      })
    })
  },
  {
    name: 'chat-like (qwen-image-3.0) → messages[] + prompt_extend/watermark/negative_prompt',
    input: {
      ...base,
      modelId: 'qwen-image-3.0',
      prompt: 'a fox',
      n: 2,
      size: '1328x1328',
      modelDescriptor: descriptor('qwen-image-3.0', 'generate'),
      providerParams: { addWatermark: false, negativePrompt: 'blurry', promptExtend: true }
    },
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({
        messages: z.array(z.strictObject({ role: z.literal('user'), content: z.array(messagePart) }))
      }),
      parameters: z.strictObject({
        size: z.literal('1328*1328'),
        n: z.literal(2),
        negative_prompt: z.literal('blurry'),
        prompt_extend: z.literal(true),
        watermark: z.literal(false)
      })
    })
  },
  {
    name: 'chat-like (canonical qwen-image-3-0) → same family as the dotted apiModelId',
    input: {
      ...base,
      modelId: 'qwen-image-3.0',
      prompt: 'a fox',
      modelDescriptor: descriptor('qwen-image-3-0', 'generate'),
      providerParams: {}
    },
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({
        messages: z.array(z.strictObject({ role: z.literal('user'), content: z.array(messagePart) }))
      }),
      parameters: z.unknown().optional()
    })
  },
  {
    name: 'wanx-v1 → input.ref_image + parameters.style/ref_*',
    input: {
      ...base,
      modelId: 'wanx-v1',
      prompt: 'a fox',
      size: '1024x1024',
      seed: 7,
      files: file([9]),
      modelDescriptor: descriptor('wanx-v1', 'generate'),
      providerParams: {
        style: '<photography>',
        refStrength: 0.5,
        refMode: 'repaint'
      }
    },
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ prompt: z.string(), ref_image: z.string() }),
      parameters: z.strictObject({
        size: z.string(),
        seed: z.number().int(),
        style: z.string(),
        ref_strength: z.number(),
        ref_mode: z.string()
      })
    })
  },
  {
    name: 'wan2.5-i2i → input.images[]',
    input: {
      ...base,
      modelId: 'wan2.5-i2i-preview',
      prompt: 'a fox',
      size: '1024x1024',
      files: [
        { mediaType: 'image/png', data: new Uint8Array([1]) },
        { mediaType: 'image/jpeg', data: new Uint8Array([2]) }
      ] as ImageGenerationSubmitInput['files'],
      modelDescriptor: descriptor('wan2.5-i2i-preview', 'edit'),
      providerParams: {}
    },
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ prompt: z.string(), images: z.array(z.string()) }),
      parameters: z.strictObject({ size: z.string() })
    })
  },
  {
    name: 'qwen-mt-image → input.image_url + source/target lang (no prompt)',
    input: {
      ...base,
      modelId: 'qwen-mt-image',
      prompt: undefined,
      files: file([4, 5, 6]),
      modelDescriptor: descriptor('qwen-mt-image', 'generate'),
      providerParams: { sourceLang: 'auto', targetLang: 'en' }
    },
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ image_url: z.string(), source_lang: z.string(), target_lang: z.string() })
    })
  },
  {
    name: 'wanx2.1-imageedit → input.function + base_image_url + parameters',
    input: {
      ...base,
      modelId: 'wanx2.1-imageedit',
      prompt: 'a fox',
      files: file([7, 8]),
      seed: 3,
      modelDescriptor: descriptor('wanx2.1-imageedit', 'edit'),
      providerParams: {
        function: 'super_resolution',
        upscaleFactor: 2,
        addWatermark: true
      }
    },
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({ function: z.string(), prompt: z.string(), base_image_url: z.string() }),
      parameters: z.strictObject({ seed: z.number().int(), watermark: z.boolean(), upscale_factor: z.number() })
    })
  }
]

describe('DashScope request boundary', () => {
  const transport = createDashScopeTransport({ apiKey: 'ds-key', imageBaseURL: host })

  for (const c of CASES) {
    it(`${c.name}: satisfies the wire contract and matches snapshot`, async () => {
      const req = await captureImageRequest(transport, c.input)
      expect(req.url).toBe(`${host}/api/v1/services/aigc/image`)
      c.schema.parse(req.body)
      expect(req.body).toMatchSnapshot()
    })
  }

  it('honors the injected proxy-aware fetch and provider extra headers', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ output: { task_id: 't-1', task_status: 'PENDING' } }), { status: 200 })
      )
    const proxiedTransport = createDashScopeTransport({
      apiKey: 'ds-key',
      imageBaseURL: host,
      fetch: fetchSpy,
      headers: { 'X-Custom': 'on' }
    })

    const submit = await proxiedTransport.submit({
      ...base,
      modelId: 'qwen-image-3.0',
      prompt: 'a fox',
      modelDescriptor: descriptor('qwen-image-3.0', 'generate'),
      providerParams: {}
    })

    expect(submit).toEqual({ taskId: 't-1' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(`${host}/api/v1/services/aigc/image`)
    const headers = new Headers(init.headers as HeadersInit)
    expect(headers.get('authorization')).toBe('Bearer ds-key')
    expect(headers.get('x-custom')).toBe('on')
  })

  it.each([
    {
      name: 'cn host',
      baseURL: `${host}/compatible-mode/v1`,
      expectedURL: `${host}/compatible-api/v1/reranks`
    },
    {
      name: 'intl host',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      expectedURL: 'https://dashscope-intl.aliyuncs.com/compatible-api/v1/reranks'
    },
    {
      name: 'proxy path',
      baseURL: 'https://proxy.example.com/ds/compatible-mode/v1',
      expectedURL: 'https://proxy.example.com/ds/compatible-api/v1/reranks'
    }
  ])(
    'posts rerank requests to the DashScope compatible-api reranks endpoint on $name',
    async ({ baseURL, expectedURL }) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [{ index: 1, relevance_score: 0.92 }]
          })
        )
      )
      const provider = createDashScopeProvider({
        apiKey: 'ds-key',
        baseURL,
        fetch
      })

      await provider.rerankingModel('gte-rerank-v2').doRerank({
        query: 'hello',
        documents: { type: 'text', values: ['alpha', 'beta'] },
        topN: 1
      })

      expect(fetch).toHaveBeenCalledWith(expectedURL, expect.objectContaining({ method: 'POST' }))
      const init = fetch.mock.calls[0]?.[1] as RequestInit
      expect(JSON.parse(init.body as string)).toEqual({
        model: 'gte-rerank-v2',
        query: 'hello',
        documents: ['alpha', 'beta'],
        top_n: 1
      })
    }
  )
})

describe('DashScope poll resume (restart-safe response family)', () => {
  const succeeded = (output: Record<string, unknown>) =>
    new Response(JSON.stringify({ output: { task_status: 'SUCCEEDED', ...output } }), { status: 200 })

  it('uses the persisted modelDescriptor to pick the response family when pendingDescriptors is empty', async () => {
    // A fresh transport == post-restart: the submit-time pendingDescriptors entry is gone.
    const transport = createDashScopeTransport({ apiKey: 'ds-key', imageBaseURL: host })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(succeeded({ image_url: 'https://img.example/x.png' }))
    try {
      // qwen-mt-image → 'image_url' family. Without the descriptor it would fall back
      // to 'results' and return [] even though the remote task succeeded.
      const urls = await transport.poll('task-resumed', {
        modelDescriptor: descriptor('qwen-mt-image', 'generate')
      })
      expect(urls).toEqual(['https://img.example/x.png'])
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('defaults to the results family when no descriptor is available', async () => {
    const transport = createDashScopeTransport({ apiKey: 'ds-key', imageBaseURL: host })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(succeeded({ results: [{ url: 'https://img.example/r.png' }] }))
    try {
      const urls = await transport.poll('task-resumed', {})
      expect(urls).toEqual(['https://img.example/r.png'])
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('DashScope newly registered and dated image models', () => {
  const transport = createDashScopeTransport({ apiKey: 'ds-key', imageBaseURL: host })
  const syncEndpoint = '/api/v1/services/aigc/multimodal-generation/generation'
  const syncDescriptor = (id: string, mode: ImageGenerationMode, endpoint = syncEndpoint) => ({
    id,
    endpoint,
    isSync: true,
    mode
  })

  it('routes dated qwen-image-max-2025-12-30 with size and seed via multimodal-generation', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'qwen-image-max-2025-12-30',
      prompt: 'a mountain sunrise',
      size: '1664x928',
      seed: 42,
      modelDescriptor: syncDescriptor('qwen-image-max-2025-12-30', 'generate'),
      providerParams: { promptExtend: true, addWatermark: false }
    })

    expect(req.url).toBe(`${host}${syncEndpoint}`)
    expect(req.body).toEqual({
      model: 'qwen-image-max-2025-12-30',
      input: { messages: [{ role: 'user', content: [{ text: 'a mountain sunrise' }] }] },
      parameters: { size: '1664*928', seed: 42, prompt_extend: true, watermark: false }
    })
  })

  it('routes dated qwen-image-plus-2026-01-09 on multimodal-generation with size and seed', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'qwen-image-plus-2026-01-09',
      prompt: 'a lantern street',
      size: '1472x1140',
      seed: 19,
      modelDescriptor: syncDescriptor('qwen-image-plus-2026-01-09', 'generate'),
      providerParams: { promptExtend: true, addWatermark: false }
    })

    expect(req.url).toBe(`${host}${syncEndpoint}`)
    expect(req.body).toEqual({
      model: 'qwen-image-plus-2026-01-09',
      input: { messages: [{ role: 'user', content: [{ text: 'a lantern street' }] }] },
      parameters: { size: '1472*1140', seed: 19, prompt_extend: true, watermark: false }
    })
  })

  it('routes dated qwen-image-2.0-pro-2026-03-03 with 2688x1536, n=3, and seed=7', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'qwen-image-2.0-pro-2026-03-03',
      prompt: 'a glass greenhouse',
      n: 3,
      size: '2688x1536',
      seed: 7,
      modelDescriptor: syncDescriptor('qwen-image-2.0-pro-2026-03-03', 'generate'),
      providerParams: { negativePrompt: 'blurry', promptExtend: true, addWatermark: false }
    })

    expect(req.url).toBe(`${host}${syncEndpoint}`)
    expect(req.body).toEqual({
      model: 'qwen-image-2.0-pro-2026-03-03',
      input: { messages: [{ role: 'user', content: [{ text: 'a glass greenhouse' }] }] },
      parameters: {
        size: '2688*1536',
        n: 3,
        seed: 7,
        negative_prompt: 'blurry',
        prompt_extend: true,
        watermark: false
      }
    })
  })

  it('routes qwen-image-2.1-pro edit with reference images, n=2, seed=11, and no explicit size', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'qwen-image-2.1-pro',
      prompt: 'add warm rim light',
      n: 2,
      seed: 11,
      files: file([1, 2]),
      modelDescriptor: syncDescriptor('qwen-image-2.1-pro', 'edit'),
      providerParams: { promptExtend: true, addWatermark: false }
    })

    expect(req.url).toBe(`${host}${syncEndpoint}`)
    expect(req.body).toEqual({
      model: 'qwen-image-2.1-pro',
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: 'add warm rim light' }, { image: 'data:image/png;base64,AQI=' }]
          }
        ]
      },
      parameters: { n: 2, seed: 11, prompt_extend: true, watermark: false }
    })
  })

  it.each(['qwen-image-edit-max-2026-01-16', 'qwen-image-edit-plus-2025-12-15'])(
    'routes dated edit model %s with input image, size=2048x2048, n=4, and seed=99',
    async (modelId) => {
      const req = await captureImageRequest(transport, {
        ...base,
        modelId,
        prompt: 'replace sky with dusk',
        n: 4,
        size: '2048x2048',
        seed: 99,
        files: file([4, 5]),
        modelDescriptor: syncDescriptor(modelId, 'edit'),
        providerParams: { promptExtend: true, addWatermark: false }
      })

      expect(req.url).toBe(`${host}${syncEndpoint}`)
      expect(req.body).toEqual({
        model: modelId,
        input: {
          messages: [
            {
              role: 'user',
              content: [{ text: 'replace sky with dusk' }, { image: 'data:image/png;base64,BAU=' }]
            }
          ]
        },
        parameters: { size: '2048*2048', n: 4, seed: 99, prompt_extend: true, watermark: false }
      })
    }
  )

  it('routes z-image-turbo with 1024x1536, seed=123, and prompt_extend=false', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'z-image-turbo',
      prompt: 'editorial portrait',
      n: 1,
      size: '1024x1536',
      seed: 123,
      modelDescriptor: syncDescriptor('z-image-turbo', 'generate'),
      providerParams: { promptExtend: false }
    })

    expect(req.url).toBe(`${host}${syncEndpoint}`)
    expect(req.body).toEqual({
      model: 'z-image-turbo',
      input: { messages: [{ role: 'user', content: [{ text: 'editorial portrait' }] }] },
      parameters: { size: '1024*1536', seed: 123, prompt_extend: false }
    })
  })

  it('normalizes U+00D7 dimension separator (1536×1024) on z-image-turbo to 1536*1024', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'z-image-turbo',
      prompt: 'landscape scene',
      n: 1,
      size: '1536×1024' as ImageGenerationSubmitInput['size'],
      modelDescriptor: syncDescriptor('z-image-turbo', 'generate'),
      providerParams: {}
    })

    expect(req.body).toMatchObject({
      model: 'z-image-turbo',
      parameters: { size: '1536*1024' }
    })
  })

  it('routes catalog-declared qwen-image-plus via multimodal-generation, preserves legacy text2image endpoint fallback, and rejects override-less submits without modelDescriptor', async () => {
    const catalog = ProviderModelListSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../../../../../../packages/provider-registry/data/provider-models.json', import.meta.url),
          'utf8'
        )
      )
    )
    const catalogTransport = catalog.overrides.find(
      (row) => row.providerId === 'dashscope' && row.modelId === 'qwen-image-plus'
    )?.imageGeneration?.modes.generate?.vendorTransport
    expect(catalogTransport).toEqual({ endpoint: syncEndpoint, isSync: true })

    const sharedInput = {
      ...base,
      modelId: 'qwen-image-plus',
      prompt: 'a lantern street',
      size: '1664x928',
      seed: 19,
      providerParams: { negativePrompt: 'blurry', promptExtend: true, addWatermark: false }
    } satisfies ImageGenerationSubmitInput

    const catalogReq = await captureImageRequest(transport, {
      ...sharedInput,
      modelDescriptor: {
        id: 'qwen-image-plus',
        endpoint: catalogTransport!.endpoint,
        isSync: catalogTransport!.isSync,
        mode: 'generate'
      }
    })
    expect(catalogReq.url).toBe(`${host}${syncEndpoint}`)
    expect(catalogReq.headers.get('X-DashScope-Async')).toBeNull()
    expect(catalogReq.body).toEqual({
      model: 'qwen-image-plus',
      input: { messages: [{ role: 'user', content: [{ text: 'a lantern street' }] }] },
      parameters: { size: '1664*928', seed: 19, negative_prompt: 'blurry', prompt_extend: true, watermark: false }
    })

    const legacyEndpoint = '/api/v1/services/aigc/text2image/image-synthesis'
    const legacyReq = await captureImageRequest(transport, {
      ...sharedInput,
      modelDescriptor: { id: 'qwen-image-plus', endpoint: legacyEndpoint, isSync: false, mode: 'generate' }
    })
    expect(legacyReq.url).toBe(`${host}${legacyEndpoint}`)
    expect(legacyReq.headers.get('X-DashScope-Async')).toBe('enable')
    expect(legacyReq.body).toEqual({
      model: 'qwen-image-plus',
      input: { prompt: 'a lantern street', negative_prompt: 'blurry' },
      parameters: { size: '1664*928', seed: 19, prompt_extend: true, watermark: false }
    })

    await expect(
      transport.submit({
        ...base,
        modelId: 'qwen-image-plus',
        prompt: 'a lantern street',
        modelDescriptor: undefined,
        providerParams: {}
      })
    ).rejects.toThrow('Missing modelDescriptor for DashScope model: qwen-image-plus')
  })
})
