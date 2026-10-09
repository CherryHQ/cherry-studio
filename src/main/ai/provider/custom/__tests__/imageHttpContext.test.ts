import type { FetchFunction } from '@ai-sdk/provider-utils'
import { describe, expect, it, vi } from 'vitest'

import { registryImageDescriptor } from '../../__tests__/imageCatalogFixtures'
import { createAihubmixFluxTransport } from '../aihubmix/aihubmixFlux'
import { createAihubmixImageTransport } from '../aihubmix/aihubmixImageTransport'
import { createDashScopeTransport } from '../dashscope/dashscopeTransport'
import { createDmxapiTransport } from '../dmxapi/dmxapiTransport'
import type { ImageGenerationTransport, ImageTransportDescriptor } from '../imageTransport'
import { createModelscopeTransport } from '../modelscope/modelscopeTransport'
import { createOllamaTransport } from '../ollama/ollamaTransport'
import { createOvmsTransport } from '../ovms/ovmsTransport'
import { createPpioTransport } from '../ppio/ppioTransport'
import { createSiliconTransport } from '../silicon/siliconTransport'
import { createTokenhubTransport } from '../tokenhub/tokenhubTransport'

type Settings = { apiKey: string; baseURL: string; headers: Record<string, string>; fetch: FetchFunction }
type Case = {
  provider: string
  modelId: string
  descriptor?: ImageTransportDescriptor
  create: (settings: Settings) => ImageGenerationTransport
  submitResponse: unknown
  queryResponse?: unknown
  protocolHeader?: [string, string]
}
const ppio = registryImageDescriptor('ppio', 'jimeng-txt2img-v3.1')
const dashscope = registryImageDescriptor('dashscope', 'qwen-mt-image', 'generate', true)
const tokenhub = registryImageDescriptor('tokenhub', 'vidu-image-q2')
const cases: Case[] = [
  // Response fixtures: https://ppio.com/docs/models/reference-get-async-task-result (retrieved 2026-07-27).
  {
    provider: 'ppio',
    modelId: ppio.id,
    descriptor: ppio,
    create: (s) => createPpioTransport({ ...s, modelDescriptor: ppio }),
    submitResponse: { task_id: 'accepted' },
    queryResponse: { task: { status: 'TASK_STATUS_QUEUED' } }
  },
  // https://help.aliyun.com/en/model-studio/manage-asynchronous-tasks (retrieved 2026-07-27).
  {
    provider: 'dashscope',
    modelId: dashscope.id,
    descriptor: dashscope,
    create: (s) => createDashScopeTransport({ ...s, modelDescriptor: dashscope }),
    submitResponse: { output: { task_id: 'accepted' } },
    queryResponse: { output: { task_status: 'PENDING' } },
    protocolHeader: ['x-dashscope-async', 'enable']
  },
  // https://modelscope.cn/docs/model-service/API-Inference/intro (retrieved 2026-07-27).
  {
    provider: 'modelscope',
    modelId: 'Qwen/Qwen-Image',
    create: createModelscopeTransport,
    submitResponse: { task_id: 'accepted' },
    queryResponse: { task_status: 'PENDING' },
    protocolHeader: ['x-modelscope-async-mode', 'true']
  },
  // https://cloud.tencent.com/document/product/1823/135746 (retrieved 2026-09-09).
  {
    provider: 'tokenhub',
    modelId: tokenhub.id,
    descriptor: tokenhub,
    create: (s) => createTokenhubTransport({ ...s, modelDescriptor: tokenhub }),
    submitResponse: { task_id: 'accepted', state: 'created' },
    queryResponse: { state: 'queueing' }
  },
  // https://docs.aihubmix.com/cn/api/Image-Gen (retrieved 2026-07-27).
  {
    provider: 'aihubmix-flux',
    modelId: 'flux-2-pro',
    create: (s) => createAihubmixFluxTransport({ ...s, apiRoot: s.baseURL }),
    submitResponse: { output: [{ taskId: 'accepted' }] },
    queryResponse: { status: 'Pending' }
  },
  // https://docs.aihubmix.com/cn/api/IdeogramAI (retrieved 2026-09-09).
  {
    provider: 'aihubmix-ideogram',
    modelId: 'ideogram/V3',
    create: (s) =>
      createAihubmixImageTransport({
        ...s,
        apiRoot: s.baseURL,
        binding: { kind: 'ideogram-v3', operation: 'generate' }
      }),
    submitResponse: { data: [{ url: 'https://images.example/one.png' }] }
  },
  // https://doc.dmxapi.cn/img-qwen-image.html (retrieved 2026-09-09).
  {
    provider: 'dmxapi',
    modelId: 'qwen-image',
    create: (s) => createDmxapiTransport({ ...s, binding: { modelId: 'qwen-image', family: 'openai-flat-async' } }),
    submitResponse: {
      extra: { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://images.example/one.png' }] } }
    }
  },
  // https://api-docs.siliconflow.cn/docs/api/images-generations-post (retrieved 2026-09-09).
  {
    provider: 'silicon',
    modelId: 'Qwen/Qwen-Image',
    create: (s) =>
      createSiliconTransport({ url: ({ path }) => `${s.baseURL}${path}`, headers: () => s.headers, fetch: s.fetch }),
    submitResponse: { images: [{ url: 'https://images.example/one.png' }] }
  },
  // https://docs.openvino.ai/2026/model-server/ovms_docs_rest_api_image_generation.html (retrieved 2026-09-09).
  { provider: 'ovms', modelId: 'sd', create: createOvmsTransport, submitResponse: { data: [{ b64_json: 'AQID' }] } },
  // Characterization only: Ollama has no reliable public image-response protocol source.
  { provider: 'ollama', modelId: 'x/z-image-turbo', create: createOllamaTransport, submitResponse: { image: 'AQID' } }
]

describe('image HTTP request context', () => {
  it.each(cases)(
    '$provider preserves case-insensitive precedence through submit, query and remote cancel',
    async (entry) => {
      const requests: Request[] = []
      const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected global fetch'))
      try {
        const transport = entry.create({
          baseURL: 'https://provider.example',
          apiKey: 'default-key',
          headers: {
            authorization: 'Bearer provider-key',
            'X-Source': 'provider',
            'X-App': 'Cherry',
            'api-key': 'provider-key',
            'X-DashScope-Async': 'disable-provider',
            'X-ModelScope-Async-Mode': 'false',
            'Content-Type': 'application/json'
          },
          fetch: async (url, init) => {
            const request = new Request(url, init)
            requests.push(request)
            if (request.url.endsWith('/cancel')) return new Response(null, { status: 204 })
            return Response.json(request.method === 'GET' ? entry.queryResponse : entry.submitResponse)
          }
        })
        const headers = {
          Authorization: 'Bearer call-key',
          'x-source': 'call',
          'Api-Key': 'call-key',
          'x-dashscope-async': 'disable-call',
          'x-modelscope-async-mode': 'false'
        }
        const submitted = await transport.submit({
          modelId: entry.modelId,
          prompt: 'a fox',
          n: 1,
          size: undefined,
          seed: undefined,
          files:
            entry.provider === 'dashscope' ? [{ type: 'url', url: 'https://images.example/input.png' }] : undefined,
          mask: undefined,
          modelDescriptor: entry.descriptor,
          providerParams: {},
          headers
        })
        if (submitted.kind === 'submitted') {
          if (transport.task.kind !== 'supported') throw new Error('Submitted task must have query capability')
          expect(
            await transport.task.query(submitted.taskId, {
              modelDescriptor: entry.descriptor,
              providerParams: {},
              headers,
              signal: new AbortController().signal
            })
          ).toMatchObject({ kind: 'pending' })
          if (transport.task.cancel.kind === 'supported') {
            await transport.task.cancel.cancelRemote(submitted.taskId, {
              modelDescriptor: entry.descriptor,
              providerParams: {},
              headers,
              signal: undefined
            })
          }
        }
        for (const request of requests) {
          expect(request.headers.get('authorization')).toBe('Bearer call-key')
          expect(request.headers.get('api-key')).toBe('call-key')
          expect(request.headers.get('x-source')).toBe('call')
          expect(request.headers.get('x-app')).toBe('Cherry')
        }
        if (entry.protocolHeader) expect(requests[0].headers.get(entry.protocolHeader[0])).toBe(entry.protocolHeader[1])
        if (entry.provider === 'aihubmix-ideogram') {
          expect(requests[0].headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
          expect((await requests[0].formData()).get('prompt')).toBe('a fox')
        }
        expect(globalFetch).not.toHaveBeenCalled()
      } finally {
        globalFetch.mockRestore()
      }
    }
  )
})
