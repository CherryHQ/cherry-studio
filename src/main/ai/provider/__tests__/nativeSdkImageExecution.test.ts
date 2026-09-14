import { generateImage } from '@cherrystudio/ai-core'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import type { ParamValues } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import providerModels from '../../../../../packages/provider-registry/data/provider-models.json'
import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import type { AppProviderSettingsMap } from '../../types'
import { extensions } from '../extensions'
import { resolveImageExecutionTarget } from '../imageExecutionTarget'
import { buildSdkImageOptions, resolveSdkImageConfig } from '../imageSdk'
import { registryImageSupport } from './imageCatalogFixtures'

const { resolveApiKey } = vi.hoisted(() => ({ resolveApiKey: vi.fn() }))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { resolveApiKey } }))
extensionRegistry.registerAll(extensions)

const OUTPUT = 'data:image/png;base64,AQID'
const requests: Request[] = []
beforeEach(() => {
  requests.length = 0
  resolveApiKey.mockReturnValue({ value: 'image-key', apiKeySelection: { attribution: 'unknown' } })
})

// Native adapters must execute the same bound protocol as Jobs, not placeholders or generic compatible HTTP.
describe('native ImageModelV3 adapters execute prepared protocols', () => {
  it.each([
    // https://ppio.com/docs/models/reference-get-async-task-result — retrieved 2026-09-09.
    {
      providerId: 'ppio',
      modelId: 'jimeng-txt2img-v3.1',
      baseURL: 'https://api.ppinfra.com/v3/openai',
      params: { addWatermark: false },
      submit: { task_id: 'accepted' },
      query: { task: { status: 'TASK_STATUS_SUCCEED' }, images: [{ image_url: OUTPUT }] },
      expected: { logo_info: { add_logo: false } },
      queryPath: '/v3/async/task-result?task_id=accepted'
    },
    // https://help.aliyun.com/zh/model-studio/qwen-image-api — retrieved 2026-09-09.
    {
      providerId: 'dashscope',
      modelId: 'qwen-image',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      params: { promptExtend: false },
      submit: { output: { task_id: 'accepted' } },
      query: { output: { task_status: 'SUCCEEDED', results: [{ url: OUTPUT }] } },
      expected: { parameters: { prompt_extend: false } },
      queryPath: '/api/v1/tasks/accepted'
    },
    // https://cloud.tencent.com/document/product/1823/135746 — retrieved 2026-09-09.
    {
      providerId: 'tokenhub',
      modelId: 'vidu-image-q2',
      baseURL: 'https://tokenhub.tencentmaas.com/v1',
      params: { resolution: '1080p' },
      submit: { task_id: 'accepted' },
      query: { state: 'success', creations: [{ url: OUTPUT }] },
      expected: { resolution: '1080p' },
      queryPath: '/v1/wand/vidu-image/tasks/accepted'
    },
    // https://modelscope.cn/docs/model-service/API-Inference/intro — retrieved 2026-09-09.
    {
      providerId: 'modelscope',
      modelId: 'Qwen/Qwen-Image',
      baseURL: 'https://api-inference.modelscope.cn/v1',
      params: { numInferenceSteps: 20, guidanceScale: 0 },
      submit: { task_id: 'accepted' },
      query: { task_status: 'SUCCEED', output_images: [OUTPUT] },
      expected: { steps: 20, guidance: 0 },
      queryPath: '/v1/tasks/accepted'
    }
  ])('$providerId forwards canonical values and call headers through submit and query', async (entry) => {
    vi.mocked(net.fetch).mockImplementation(async (url, init) => {
      const request = new Request(url, init)
      requests.push(request)
      return Response.json(request.method === 'POST' ? entry.submit : entry.query)
    })
    const provider = makeProvider({
      id: `private-${entry.providerId}`,
      presetProviderId: entry.providerId,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: entry.baseURL, adapterFamily: 'openai-compatible' }
      }
    })
    const row = providerModels.overrides.find(
      (row) => row.providerId === entry.providerId && (row.apiModelId ?? row.modelId) === entry.modelId
    )
    const support = row ? registryImageSupport(entry.providerId, entry.modelId) : undefined
    const model = makeModel({
      id: `${provider.id}::${entry.modelId}`,
      providerId: provider.id,
      apiModelId: entry.modelId
    })
    const target = resolveImageExecutionTarget(provider, model, 'generate', support)
    if (target.kind === 'unavailable' || target.scheduling !== 'job') throw new Error('Expected native Job protocol')
    const { sdkConfig } = await resolveSdkImageConfig(provider, model, target, undefined)
    const params: ParamValues = entry.params
    const result = await generateImage<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      buildSdkImageOptions(
        { prompt: 'a fox', paramValues: { ...params, seed: 0 }, requestOptions: { headers: { 'x-call': 'once' } } },
        sdkConfig,
        undefined
      )
    )
    expect(result.images[0].base64).toBe('AQID')
    expect(requests.map((request) => request.method)).toEqual(['POST', 'GET'])
    expect(new URL(requests[1].url).pathname + new URL(requests[1].url).search).toBe(entry.queryPath)
    expect(await requests[0].json()).toMatchObject(entry.expected)
    expect(requests.every((request) => request.headers.get('x-call') === 'once')).toBe(true)
  })
})
