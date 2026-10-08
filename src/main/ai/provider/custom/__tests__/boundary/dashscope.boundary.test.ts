import { describe, expect, it, vi } from 'vitest'

import { registryImageDescriptor } from '../../../__tests__/imageCatalogFixtures'
import { createDashScopeProvider } from '../../dashscope/dashscopeProvider'
import type { DashScopeProviderParams } from '../../dashscope/dashscopeTransport'
import { createDashScopeTransport } from '../../dashscope/dashscopeTransport'
import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'

const host = 'https://dashscope.aliyuncs.com'
const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined
} satisfies Partial<ImageGenerationSubmitInput<DashScopeProviderParams>>

const descriptor = (id: string, hasImages = false) => registryImageDescriptor('dashscope', id, 'generate', hasImages)

describe('DashScope request boundary', () => {
  it('keeps the resolved model and protocol when submit carries a different descriptor', async () => {
    const requests: Request[] = []
    const transport = createDashScopeTransport({
      apiKey: 'key',
      modelDescriptor: descriptor('qwen-image'),
      fetch: async (url, init) => {
        requests.push(new Request(url, init))
        return Response.json({ output: { task_id: 'accepted' } })
      }
    })
    // https://help.aliyun.com/zh/model-studio/qwen-image-api — retrieved 2026-09-09.
    await transport.submit({
      ...base,
      modelId: 'not-the-bound-model',
      modelDescriptor: descriptor('qwen-mt-image', true),
      prompt: 'a fox',
      seed: 0,
      providerParams: { promptExtend: false, addWatermark: false }
    })
    expect(requests[0].url).toBe(`${host}/api/v1/services/aigc/text2image/image-synthesis`)
    expect(await requests[0].json()).toEqual({
      model: 'qwen-image',
      input: { prompt: 'a fox' },
      parameters: { seed: 0, prompt_extend: false, watermark: false }
    })
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
    const transport = createDashScopeTransport({
      apiKey: 'ds-key',
      imageBaseURL: host,
      modelDescriptor: descriptor('qwen-mt-image', true)
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(succeeded({ image_url: 'https://img.example/x.png' }))
    try {
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')
      const state = await transport.task.query('task-resumed', {
        signal: new AbortController().signal,
        modelDescriptor: descriptor('qwen-mt-image', true),
        headers: undefined,
        providerParams: {}
      })
      expect(state).toEqual({ kind: 'completed', imageUrls: ['https://img.example/x.png'] })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('fails loudly when the persisted descriptor is unavailable', async () => {
    const transport = createDashScopeTransport({
      apiKey: 'ds-key',
      imageBaseURL: host,
      modelDescriptor: descriptor('qwen-mt-image', true)
    })
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
      const transport = createDashScopeTransport({
        apiKey: 'ds-key',
        imageBaseURL: host,
        fetch,
        modelDescriptor: descriptor('qwen-mt-image', true)
      })
      if (transport.task.kind !== 'supported') throw new Error('expected task transport')

      await expect(
        transport.task.query('task-resumed', {
          signal: new AbortController().signal,
          modelDescriptor: descriptor('qwen-mt-image', true),
          headers: undefined,
          providerParams: {}
        })
      ).rejects.toThrow('Invalid JSON response')
    }
  })

  it('POSTs the documented remote cancel endpoint with resolved headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const transport = createDashScopeTransport({
      modelDescriptor: descriptor('qwen-image'),
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
      modelDescriptor: descriptor('qwen-mt-image', true),
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
