import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import { type AiImageRequest, AiService, type AsInProcess } from '../../AiService'
import { registryImageSupport } from '../../provider/__tests__/imageCatalogFixtures'
import { extensions } from '../../provider/extensions'
import { executeImageRequest, probeImageRequest } from '../executeImageRequest'
import { prepareImageExecution } from '../prepareImageRequest'

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
  providerRegistryService: {
    getImageGenerationSupport: getSupport,
    isRegistryProvider: vi.fn<typeof providerRegistryService.isRegistryProvider>().mockReturnValue(false)
  }
}))
vi.mock('@main/data/services/AiUsageRecordService', () => ({ aiUsageRecordService: { recordInvocation } }))
extensionRegistry.registerAll(extensions)

const OUTPUT = 'data:image/png;base64,AQID'
const requests: Request[] = []
beforeEach(() => {
  vi.clearAllMocks()
  BaseService.resetInstances()
  requests.length = 0
  getSupport.mockReturnValue(registryImageSupport('dashscope', 'qwen-mt-image'))
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
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='

function sdkRequest(overrides: Partial<AsInProcess<AiImageRequest>> = {}) {
  const provider = makeProvider({
    id: 'private-openai',
    presetProviderId: 'openai',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { adapterFamily: 'openai', baseUrl: 'https://provider.example/v1' }
    }
  })
  const model = makeModel({
    id: 'private-openai::gpt-image-1',
    apiModelId: 'gpt-image-1',
    providerId: provider.id,
    endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
  })
  getSupport.mockReturnValue(undefined)
  return prepareImageExecution(
    {
      uniqueModelId: model.id,
      prompt: 'a red circle',
      paramValues: {},
      cleanupPolicy: 'delete_when_unreferenced',
      apiKeyOverride: 'provider-secret',
      ...overrides
    },
    provider,
    model
  )
}

// OpenAI image edit uses multipart input: https://developers.openai.com/api/reference/resources/images/methods/edit (retrieved 2026-09-09).
describe('Main image downloads use the application request path', () => {
  it('downloads SDK input, mask and output through Electron without leaking provider or call credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected global fetch')))
    vi.mocked(net.fetch).mockImplementation(async (url, init) => {
      const request = new Request(url, init)
      requests.push(request)
      return request.method === 'GET'
        ? new Response(Buffer.from(PNG, 'base64'))
        : Response.json({ data: [{ url: 'https://images.example/output.png' }] })
    })
    await probeImageRequest(
      sdkRequest({
        inputImages: ['https://images.example/input.png'],
        mask: 'https://images.example/mask.png',
        requestOptions: { headers: { Authorization: 'Bearer call-secret', Cookie: 'provider-cookie' } }
      })
    )
    expect(requests.map((request) => request.url)).toEqual([
      'https://images.example/input.png',
      'https://images.example/mask.png',
      'https://provider.example/v1/images/edits',
      'https://images.example/output.png'
    ])
    for (const request of requests.filter((request) => request.method === 'GET')) {
      expect(request.headers.get('authorization')).toBeNull()
      expect(request.headers.get('cookie')).toBeNull()
    }
    expect(requests[2].headers.get('authorization')).toBe('Bearer call-secret')
    const form = await requests[2].formData()
    const images = [...form.values()].filter((value): value is File => value instanceof File)
    expect(images).toHaveLength(2)
    for (const image of images) expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe(PNG)
  })

  it('does not submit generation after reference download cancellation', async () => {
    const controller = new AbortController()
    vi.mocked(net.fetch).mockImplementation(async (url, init) => {
      requests.push(new Request(url, init))
      controller.abort()
      throw new DOMException('Download aborted', 'AbortError')
    })
    await expect(
      probeImageRequest(
        sdkRequest({
          inputImages: ['https://images.example/input.png'],
          requestOptions: { signal: controller.signal }
        })
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests.map((request) => request.method)).toEqual(['GET'])
    expect(requests[0].signal.aborted).toBe(true)
  })

  it('does not persist partial SDK success when output download was cancelled', async () => {
    const controller = new AbortController()
    vi.mocked(net.fetch).mockImplementation(async (url, init) => {
      const request = new Request(url, init)
      requests.push(request)
      if (request.method === 'POST')
        return Response.json({ data: [{ b64_json: PNG }, { url: 'https://images.example/output.png' }] })
      controller.abort()
      throw new DOMException('Download aborted', 'AbortError')
    })
    await expect(
      executeImageRequest(
        sdkRequest({ paramValues: { numImages: 2 }, requestOptions: { signal: controller.signal } }),
        undefined
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.mocked(application.get).mock.calls.map(([name]) => name)).not.toContain('FileManager')
    expect(requests[1].signal.aborted).toBe(true)
  })
})

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
