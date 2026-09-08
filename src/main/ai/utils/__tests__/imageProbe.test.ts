import { application } from '@application'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { ImageGenerationSupportSchema } from '@cherrystudio/provider-registry'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import providerModels from '../../../../../packages/provider-registry/data/provider-models.json'
import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import { AiService } from '../../AiService'
import { extensions } from '../../provider/extensions'

const { getProvider, getModel, getSupport, resolveApiKey, recordInvocation } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  getModel: vi.fn(),
  getSupport: vi.fn(),
  resolveApiKey: vi.fn(),
  recordInvocation: vi.fn()
}))
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: getProvider, resolveApiKey }
}))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: getModel } }))
vi.mock('@main/data/services/ProviderRegistryService', () => ({
  providerRegistryService: { getImageGenerationSupport: getSupport }
}))
vi.mock('@main/data/services/AiUsageRecordService', () => ({ aiUsageRecordService: { recordInvocation } }))
extensionRegistry.registerAll(extensions)

const OUTPUT = 'data:image/png;base64,AQID'
const requests: Request[] = []
beforeEach(() => {
  vi.clearAllMocks()
  BaseService.resetInstances()
  requests.length = 0
  const row = providerModels.overrides.find((row) => row.providerId === 'dashscope' && row.modelId === 'qwen-mt-image')
  getSupport.mockReturnValue(ImageGenerationSupportSchema.parse(row?.imageGeneration))
  getProvider.mockReturnValue(
    makeProvider({
      id: 'private-dashscope',
      presetProviderId: 'dashscope',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          adapterFamily: 'openai-compatible',
          baseUrl: 'https://dashscope.example/compatible-mode/v1'
        }
      }
    })
  )
  getModel.mockReturnValue(
    makeModel({
      id: 'private-dashscope::qwen-mt-image',
      providerId: 'private-dashscope',
      apiModelId: 'qwen-mt-image',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
    })
  )
  resolveApiKey.mockImplementation((_provider, override) => ({
    value: override,
    apiKeySelection: { attribution: 'unknown' }
  }))
})
afterEach(() => vi.useRealTimers())

// https://help.aliyun.com/zh/model-studio/qwen-mt-image-api — retrieved 2026-09-09.
describe('image health checks use prepared execution', () => {
  it('uses the selected credential, required reference and language defaults through submit and query', async () => {
    vi.mocked(net.fetch).mockImplementation(async (url, init) => {
      const request = new Request(url, init)
      requests.push(request)
      return Response.json(
        request.method === 'POST'
          ? { output: { task_id: 'probe-task' } }
          : { output: { task_status: 'SUCCEEDED', image_url: OUTPUT } }
      )
    })
    const service = new AiService()
    const result = await service.checkModel({
      uniqueModelId: 'private-dashscope::qwen-mt-image',
      apiKeyOverride: 'selected-key'
    })
    expect(result.latency).toBeGreaterThanOrEqual(0)
    expect(requests.map((request) => request.method)).toEqual(['POST', 'GET'])
    expect(requests.every((request) => request.headers.get('authorization') === 'Bearer selected-key')).toBe(true)
    expect(await requests[0].json()).toMatchObject({
      model: 'qwen-mt-image',
      input: {
        source_lang: 'auto',
        target_lang: 'en',
        image_url: 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250916/ordhsk/1.webp'
      }
    })
    expect(vi.mocked(application.get).mock.calls.map(([name]) => name)).not.toContain('JobManager')
    expect(vi.mocked(application.get).mock.calls.map(([name]) => name)).not.toContain('FileManager')
  })

  it('does not report an accepted submission as healthy when the task subsequently fails', async () => {
    vi.mocked(net.fetch).mockImplementation(async (url, init) => {
      const request = new Request(url, init)
      requests.push(request)
      return Response.json(
        request.method === 'POST'
          ? { output: { task_id: 'probe-task' } }
          : { output: { task_status: 'FAILED', message: 'invalid image' } }
      )
    })
    await expect(
      new AiService().checkModel({ uniqueModelId: 'private-dashscope::qwen-mt-image', apiKeyOverride: 'selected-key' })
    ).rejects.toThrow('invalid image')
    expect(requests.some((request) => request.method === 'GET')).toBe(true)
  })

  it('rejects missing protocol before selecting credentials or starting HTTP', async () => {
    getSupport.mockReturnValue(null)
    const fetch = vi.mocked(net.fetch).mockClear()
    await expect(
      new AiService().checkModel({ uniqueModelId: 'private-dashscope::qwen-mt-image', apiKeyOverride: 'selected-key' })
    ).rejects.toThrow('No image protocol configured')
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
