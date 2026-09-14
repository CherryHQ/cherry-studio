import { generateImage } from '@cherrystudio/ai-core'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { ImageGenerationSupportSchema, type ParamValues } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type ImageOperation } from '@shared/data/types/model'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import providerModels from '../../../../../packages/provider-registry/data/provider-models.json'
import openai from '../../../../../packages/provider-registry/src/creators/openai'
import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import type { AiImageRequest } from '../../AiService'
import type { AppProviderSettingsMap } from '../../types'
import { prepareImageRequest } from '../../utils/prepareImageRequest'
import { extensions } from '../extensions'
import { resolveImageExecutionTarget } from '../imageExecutionTarget'
import { buildSdkImageOptions, resolveSdkImageConfig } from '../imageSdk'
import { registryImageSupport } from './imageCatalogFixtures'

const { resolveApiKey } = vi.hoisted(() => ({ resolveApiKey: vi.fn() }))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { resolveApiKey } }))
extensionRegistry.registerAll(extensions)

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='
const INPUT = `data:image/png;base64,${PNG}`
const requests: Request[] = []
afterEach(() => vi.useRealTimers())

beforeEach(() => {
  requests.length = 0
  resolveApiKey.mockReturnValue({ value: 'image-key', apiKeySelection: { attribution: 'unknown' } })
  vi.mocked(net.fetch).mockImplementation(async (input, init) => {
    requests.push(new Request(input, init))
    return Response.json({ data: [{ b64_json: PNG }] })
  })
})

async function execute(modelId: string, operation: ImageOperation, paramValues: ParamValues, inputImages?: string[]) {
  const provider = makeProvider({
    id: 'private-aihubmix',
    presetProviderId: 'aihubmix',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://aihubmix.example/v1', adapterFamily: 'aihubmix' }
    }
  })
  const row = providerModels.overrides.find(
    (entry) => entry.providerId === 'aihubmix' && (entry.apiModelId ?? entry.modelId) === modelId
  )
  const support = row
    ? registryImageSupport('aihubmix', modelId)
    : ImageGenerationSupportSchema.optional().parse(
        openai.models?.find((entry) => entry.id === modelId)?.imageGeneration
      )
  const model = makeModel({
    id: `${provider.id}::${row ? row.modelId : modelId}`,
    providerId: provider.id,
    apiModelId: modelId
  })
  const request: AiImageRequest = {
    prompt: 'a red circle',
    operation,
    paramValues,
    inputImages,
    cleanupPolicy: 'delete_when_unreferenced'
  }
  const normalized = prepareImageRequest(request, support)
  const prepared = { ...request, ...normalized }
  const target = resolveImageExecutionTarget(
    provider,
    model,
    normalized.operation,
    support,
    Boolean(normalized.inputImages?.length)
  )
  if (target.kind === 'unavailable') throw new Error(target.message)
  if (target.scheduling !== 'direct') throw new Error('AiHubMix must preserve direct scheduling')
  const { sdkConfig } = await resolveSdkImageConfig(provider, model, target, undefined)
  return generateImage<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
    ...buildSdkImageOptions(prepared, sdkConfig, undefined),
    experimental_download: async (downloads) =>
      downloads.map(() => ({ data: Buffer.from(PNG, 'base64'), mediaType: 'image/png' }))
  })
}

// Contracts: https://docs.aihubmix.com/cn/api/Image-Gen and /cn/api/IdeogramAI (retrieved 2026-09-09).
describe('AiHubMix prepared request execution', () => {
  it('executes the bound FLUX submit and shared polling protocol with seed zero', async () => {
    vi.useFakeTimers()
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return request.method === 'POST'
        ? Response.json({ output: [{ taskId: 'flux-task' }] })
        : Response.json({ status: 'Ready', result: { sample: INPUT } })
    })
    const result = execute('flux-2-flex', 'generate', { seed: 0, safetyTolerance: 0 })
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))
    await vi.runAllTimersAsync()
    expect((await result).images[0].base64).toBe(PNG)
    expect(requests.map((request) => request.url)).toEqual([
      'https://aihubmix.example/v1/models/bfl/flux-2-flex/predictions',
      'https://aihubmix.example/v1/tasks/flux-task'
    ])
    expect(await requests[0].json()).toEqual({ input: { prompt: 'a red circle', seed: 0, safety_tolerance: 0 } })
  })

  it.each([false, true])('keeps GPT generation on the SDK protocol (images=%s)', async (hasImages) => {
    const result = await execute('gpt-image-1', 'generate', { quality: 'high' }, hasImages ? [INPUT] : undefined)
    expect(requests[0].url).toBe(`https://aihubmix.example/v1/images/${hasImages ? 'edits' : 'generations'}`)
    if (hasImages) {
      const body = await requests[0].formData()
      expect(body.get('quality')).toBe('high')
      const file = body.get('image')
      if (!(file instanceof File)) throw new Error('Missing SDK image input')
      expect(Buffer.from(await file.arrayBuffer()).toString('base64')).toBe(PNG)
    } else {
      expect(await requests[0].json()).toMatchObject({ model: 'gpt-image-1', quality: 'high' })
    }
    expect(result.images[0].base64).toBe(PNG)
  })

  it.each([
    ['qwen-image', false],
    ['qwen-image-edit', true],
    ['irag-1.0', false],
    ['ernie-irag-edit', true]
  ] as const)('executes %s with the saved registry prediction binding', async (modelId, hasImages) => {
    const result = await execute(modelId, 'generate', { seed: 0 }, hasImages ? [INPUT] : undefined)
    expect(requests[0].url).toBe(`https://aihubmix.example/v1/models/qianfan/${modelId}/predictions`)
    const body = await requests[0].json()
    expect(body).toEqual({
      input: { prompt: 'a red circle', n: 1, seed: 0, ...(hasImages && { images: [INPUT] }) }
    })
    expect(result.images[0].base64).toBe(PNG)
  })

  it('keeps Doubao reference images independent of the generate operation and preserves false/zero', async () => {
    await execute('doubao-seedream-4-0', 'generate', { seed: 0, addWatermark: false }, [INPUT])
    expect(requests[0].url).toBe('https://aihubmix.example/v1/images/generations')
    expect(await requests[0].json()).toEqual({
      model: 'doubao-seedream-4-0',
      prompt: 'a red circle',
      response_format: 'url',
      seed: 0,
      watermark: false,
      image: INPUT
    })
  })

  it('recognizes the served Ideogram API ID rather than its canonical catalog ID', async () => {
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      requests.push(new Request(input, init))
      return Response.json({ data: [{ url: 'https://images.example/ideogram.png' }] })
    })
    await execute('ideogram/V3', 'generate', { seed: 0 })
    expect(requests[0].url).toBe('https://aihubmix.example/ideogram/v1/ideogram-v3/generate')
    expect((await requests[0].formData()).get('seed')).toBe('0')
  })

  it.each([
    ['gpt-image-1', 'remix'],
    ['custom-model', 'upscale'],
    ['qwen-image-missing', 'generate']
  ] as const)('rejects %s %s without an accidental Ideogram or compatible request', async (modelId, mode) => {
    await expect(execute(modelId, mode, {})).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })
})
