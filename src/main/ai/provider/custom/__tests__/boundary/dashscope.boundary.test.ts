import type { ImageGenerationMode } from '@shared/data/types/model'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { createDashScopeProvider } from '../../dashscope/dashscopeProvider'
import type { DashScopeProviderParams } from '../../dashscope/dashscopeTransport'
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
  [
    { mediaType: 'image/png', data: new Uint8Array(bytes) }
  ] as ImageGenerationSubmitInput<DashScopeProviderParams>['files']

const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined
} satisfies Partial<ImageGenerationSubmitInput<DashScopeProviderParams>>

const descriptor = (id: string, mode: ImageGenerationMode) => ({
  id,
  endpoint: '/api/v1/services/aigc/image',
  isSync: false,
  mode
})

const messagePart = z.union([z.strictObject({ text: z.string() }), z.strictObject({ image: z.string() })])

interface Case {
  name: string
  input: ImageGenerationSubmitInput<DashScopeProviderParams>
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
    } as ImageGenerationSubmitInput<DashScopeProviderParams>,
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
    } as ImageGenerationSubmitInput<DashScopeProviderParams>,
    schema: z.strictObject({
      model: z.string(),
      input: z.strictObject({
        messages: z.array(z.strictObject({ role: z.literal('user'), content: z.array(messagePart) }))
      })
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
    } as ImageGenerationSubmitInput<DashScopeProviderParams>,
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
      ] as ImageGenerationSubmitInput<DashScopeProviderParams>['files'],
      modelDescriptor: descriptor('wan2.5-i2i-preview', 'edit'),
      providerParams: {}
    } as ImageGenerationSubmitInput<DashScopeProviderParams>,
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
    } as ImageGenerationSubmitInput<DashScopeProviderParams>,
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
    } as ImageGenerationSubmitInput<DashScopeProviderParams>,
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

  it('uses the injected fetch and gives X-DashScope-Async final precedence', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: { task_id: 'task-1' } }), {
        status: 200
      })
    )
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('global fetch used'))
    const injectedTransport = createDashScopeTransport({
      apiKey: 'ds-key',
      imageBaseURL: host,
      headers: {
        Authorization: 'Bearer provider',
        'X-DashScope-Async': 'disabled',
        'x-provider': 'one'
      },
      fetch
    })

    await injectedTransport.submit({
      ...CASES[0].input,
      headers: {
        Authorization: 'Bearer request',
        'X-DashScope-Async': 'disabled',
        'x-request': 'two'
      }
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(globalFetch).not.toHaveBeenCalled()
    const requestHeaders = Object.fromEntries(new Headers(fetch.mock.calls[0][1]?.headers).entries())
    expect(requestHeaders).toMatchObject({
      authorization: 'Bearer request',
      'x-dashscope-async': 'enable',
      'x-provider': 'one',
      'x-request': 'two'
    })
    globalFetch.mockRestore()
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

  it('uses the persisted modelDescriptor to pick the response family after restart', async () => {
    const transport = createDashScopeTransport({ apiKey: 'ds-key', imageBaseURL: host })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(succeeded({ image_url: 'https://img.example/x.png' }))
    try {
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')
      const state = await transport.task.query('task-resumed', {
        signal: new AbortController().signal,
        modelDescriptor: descriptor('qwen-mt-image', 'generate'),
        headers: undefined,
        providerParams: {}
      })
      expect(state).toEqual({ kind: 'completed', imageUrls: ['https://img.example/x.png'] })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('fails loudly when the persisted descriptor is unavailable', async () => {
    const transport = createDashScopeTransport({ apiKey: 'ds-key', imageBaseURL: host })
    if (transport.task.kind !== 'supported') throw new Error('expected task transport')
    await expect(
      transport.task.query('task-resumed', {
        signal: new AbortController().signal,
        modelDescriptor: undefined,
        headers: undefined,
        providerParams: {}
      })
    ).rejects.toThrow(/persisted modelDescriptor/)
  })

  it('rejects a missing or unknown task status instead of assuming pending', async () => {
    for (const output of [{}, { task_status: 'UNKNOWN' }]) {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output }), { status: 200 }))
      const transport = createDashScopeTransport({ apiKey: 'ds-key', imageBaseURL: host, fetch })
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')

      await expect(
        transport.task.query('task-resumed', {
          signal: new AbortController().signal,
          modelDescriptor: descriptor('qwen-mt-image', 'generate'),
          headers: undefined,
          providerParams: {}
        })
      ).rejects.toThrow('Invalid JSON response')
    }
  })

  it('POSTs the documented remote cancel endpoint with resolved headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const transport = createDashScopeTransport({
      apiKey: 'ds-key',
      imageBaseURL: host,
      headers: { 'x-provider': 'one' },
      fetch
    })
    if (transport.task.kind !== 'supported' || transport.task.cancel.kind !== 'supported') {
      throw new Error('expected cancellable task transport')
    }

    // Contract source: https://help.aliyun.com/en/model-studio/manage-asynchronous-tasks
    // Retrieved 2026-07-27. Only PENDING tasks can be cancelled.
    await transport.task.cancel.cancelRemote('task-1', {
      signal: undefined,
      modelDescriptor: descriptor('qwen-mt-image', 'generate'),
      headers: { 'x-request': 'two' },
      providerParams: {}
    })

    expect(fetch).toHaveBeenCalledWith(
      `${host}/api/v1/tasks/task-1/cancel`,
      expect.objectContaining({ method: 'POST' })
    )
    const init = fetch.mock.calls[0][1] as RequestInit
    expect(Object.fromEntries(new Headers(init.headers).entries())).toMatchObject({
      authorization: 'Bearer ds-key',
      'x-provider': 'one',
      'x-request': 'two'
    })
  })
})
