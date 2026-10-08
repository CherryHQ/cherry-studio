import { generateImage } from '@cherrystudio/ai-core'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { ImageGenerationSupportSchema, type ParamValues } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import modelCatalog from '../../../../../packages/provider-registry/data/models.json'
import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import type { AiImageRequest } from '../../AiService'
import type { AppProviderSettingsMap } from '../../types'
import { prepareImageRequest } from '../../utils/prepareImageRequest'
import { extensions } from '../extensions'
import { resolveImageExecutionTarget } from '../imageExecutionTarget'
import { buildSdkImageOptions, resolveSdkImageConfig } from '../imageSdk'

const { resolveApiKey } = vi.hoisted(() => ({ resolveApiKey: vi.fn() }))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { resolveApiKey } }))

extensionRegistry.registerAll(extensions)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='
const requests: Request[] = []

beforeEach(() => {
  requests.length = 0
  resolveApiKey.mockReturnValue({ value: 'image-key', apiKeySelection: { attribution: 'unknown' } })
  vi.mocked(net.fetch).mockImplementation(async (input, init) => {
    requests.push(new Request(input, init))
    return Response.json({ data: [{ b64_json: PNG }] })
  })
})

async function configuration(
  adapterFamily: string,
  endpointType: EndpointType,
  modelId: string,
  providerInstanceId = `private-${adapterFamily}`
) {
  const provider = makeProvider({
    id: providerInstanceId,
    presetProviderId: adapterFamily,
    defaultChatEndpoint: endpointType,
    endpointConfigs: { [endpointType]: { baseUrl: 'https://image.example/v1', adapterFamily } }
  })
  const model = makeModel({ id: `${provider.id}::${modelId}`, providerId: provider.id, apiModelId: modelId })
  const target = resolveImageExecutionTarget(provider, model, 'generate', undefined)
  if (target.kind !== 'sdk') throw new Error('Expected an SDK delegation fixture')
  return resolveSdkImageConfig(provider, model, target, undefined)
}

function request(paramValues: ParamValues, overrides: Partial<AiImageRequest> = {}): AiImageRequest {
  return { prompt: 'a red circle', paramValues, cleanupPolicy: 'delete_when_unreferenced', ...overrides }
}

describe('canonical request to actual SDK image model', () => {
  // https://developers.openai.com/api/reference/resources/images/methods/edit — multipart form, retrieved 2026-09-09.
  it.each(['openai', 'openai-compatible', 'aihubmix', 'dmxapi'])(
    'keeps %s SDK multipart boundaries despite provider and per-call Content-Type headers',
    async (adapterFamily) => {
      const provider = makeProvider({
        id: `multipart-${adapterFamily}`,
        presetProviderId: adapterFamily,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        settings: { extraHeaders: { 'CONTENT-TYPE': 'application/json', 'x-provider': 'preserved' } },
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://image.example/v1', adapterFamily }
        }
      })
      const model = makeModel({
        id: `${provider.id}::gpt-image-1`,
        providerId: provider.id,
        apiModelId: 'gpt-image-1',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
      })
      const target = resolveImageExecutionTarget(provider, model, 'generate', undefined)
      if (target.kind === 'unavailable') throw new Error(target.message)
      const { sdkConfig } = await resolveSdkImageConfig(provider, model, target, undefined)
      const result = await generateImage<AppProviderSettingsMap>(
        sdkConfig.providerId,
        sdkConfig.providerSettings,
        buildSdkImageOptions(
          request(
            {},
            {
              inputImages: [`data:image/png;base64,${PNG}`],
              requestOptions: { headers: { 'Content-Type': 'application/json', 'x-call': 'preserved' } }
            }
          ),
          sdkConfig,
          undefined
        )
      )
      expect(requests).toHaveLength(1)
      expect(requests[0].headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
      expect(requests[0].headers.get('x-provider')).toBe('preserved')
      expect(requests[0].headers.get('x-call')).toBe('preserved')
      expect(requests[0].headers.get('authorization')).toBe('Bearer image-key')
      const body = await requests[0].formData()
      const reference = [...body.values()].find((value) => value instanceof File)
      if (!(reference instanceof File)) throw new Error('Missing multipart image input')
      expect(Buffer.from(await reference.arrayBuffer()).toString('base64')).toBe(PNG)
      expect(result.images[0].base64).toBe(PNG)
    }
  )

  // Endpoint ownership is an application contract: the selected endpoint cannot be replaced by chat configuration.
  it.each(['aihubmix', 'dmxapi'] as const)('keeps %s image requests on their selected host', async (adapterFamily) => {
    const provider = makeProvider({
      id: `split-${adapterFamily}`,
      presetProviderId: adapterFamily,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://chat.example/v1', adapterFamily },
        [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://images.example/v1', adapterFamily }
      }
    })
    const model = makeModel({
      id: `${provider.id}::gpt-image-1`,
      providerId: provider.id,
      apiModelId: 'gpt-image-1',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
    })
    const target = resolveImageExecutionTarget(provider, model, 'generate', undefined)
    if (target.kind === 'unavailable') throw new Error(target.message)
    const { sdkConfig } = await resolveSdkImageConfig(provider, model, target, undefined)
    await generateImage<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      buildSdkImageOptions(request({}), sdkConfig, undefined)
    )
    expect(new URL(requests[0].url).origin).toBe('https://images.example')
  })

  it.each(['aihubmix', 'dmxapi'] as const)(
    'keeps %s Google images on the explicit Google endpoint',
    async (adapterFamily) => {
      vi.mocked(net.fetch).mockImplementation(async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({
          candidates: [
            {
              content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] },
              finishReason: 'STOP'
            }
          ]
        })
      })
      const provider = makeProvider({
        id: `split-${adapterFamily}`,
        presetProviderId: adapterFamily,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://chat.example/v1', adapterFamily },
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://google.example/custom/v1beta', adapterFamily }
        }
      })
      const model = makeModel({
        id: `${provider.id}::gemini-3.1-flash-image-preview`,
        providerId: provider.id,
        apiModelId: 'gemini-3.1-flash-image-preview',
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
      })
      const target = resolveImageExecutionTarget(provider, model, 'generate', undefined)
      if (target.kind === 'unavailable') throw new Error(target.message)
      const { sdkConfig } = await resolveSdkImageConfig(provider, model, target, undefined)
      await generateImage<AppProviderSettingsMap>(
        sdkConfig.providerId,
        sdkConfig.providerSettings,
        buildSdkImageOptions(request({}), sdkConfig, undefined)
      )
      expect(requests[0].url).toBe(
        'https://google.example/custom/v1beta/models/gemini-3.1-flash-image-preview:generateContent'
      )
    }
  )

  // https://doc.dmxapi.com/gpt-image.html — retrieved 2026-09-09.
  it('delivers DMXAPI native GPT options to the OpenAI SDK for edits', async () => {
    const { sdkConfig } = await configuration('dmxapi', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'gpt-image-1.5')
    const result = await generateImage<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      buildSdkImageOptions(
        request({ quality: 'high' }, { inputImages: [`data:image/png;base64,${PNG}`] }),
        sdkConfig,
        undefined
      )
    )
    expect(requests[0].url).toBe('https://image.example/v1/images/edits')
    expect((await requests[0].formData()).get('quality')).toBe('high')
    expect(result.images[0].base64).toBe(PNG)
  })

  // Google ImageConfig: https://ai.google.dev/api/generate-content#ImageConfig — retrieved 2026-10-08.
  it.each(['google', 'aihubmix', 'dmxapi', 'cherryin'])(
    'delivers declared ratios through Main and %s without turning auto or absence into a ratio',
    async (adapterFamily) => {
      const entry = modelCatalog.models.find((model) => model.id === 'gemini-3-1-flash-image')
      if (!entry) throw new Error('Missing Gemini image catalog fixture')
      const support = ImageGenerationSupportSchema.parse(entry.imageGeneration)
      vi.mocked(net.fetch).mockImplementation(async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({
          candidates: [
            {
              content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] },
              finishReason: 'STOP'
            }
          ]
        })
      })
      const { sdkConfig } = await configuration(
        adapterFamily,
        adapterFamily === 'dmxapi' ? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS : ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        'gemini-3.1-flash-image'
      )
      for (const aspectRatio of ['16:9', 'auto', undefined] as const) {
        const prepared = prepareImageRequest(
          request({ imageResolution: '2K', ...(aspectRatio !== undefined && { aspectRatio }) }),
          support
        )
        expect(prepared.paramValues.aspectRatio).toBe(aspectRatio)
        const requestIndex = requests.length
        const result = await generateImage<AppProviderSettingsMap>(
          sdkConfig.providerId,
          sdkConfig.providerSettings,
          buildSdkImageOptions(prepared, sdkConfig, undefined)
        )
        const body = await requests[requestIndex].json()
        expect(body.generationConfig.imageConfig).toEqual(
          aspectRatio === '16:9' ? { imageSize: '2K', aspectRatio: '16:9' } : { imageSize: '2K' }
        )
        expect(result.images[0].base64).toBe(PNG)
      }
    }
  )

  // Wire contract: https://developers.openai.com/api/reference/resources/images (retrieved 2026-09-09).
  it('uses the compatible image namespace when a provider instance name contains a dot', async () => {
    const { sdkConfig } = await configuration(
      'openai-compatible',
      ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
      'gpt-image-1',
      'company.images'
    )
    await generateImage<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      buildSdkImageOptions(request({ quality: 'high' }), sdkConfig, undefined)
    )
    expect(await requests[0].json()).toMatchObject({ quality: 'high' })
  })

  // Wire contracts: https://developers.openai.com/api/reference/resources/images (retrieved 2026-09-09).
  it('delivers NewAPI image options even when its chat endpoint uses the Responses namespace', async () => {
    const { sdkConfig } = await configuration('newapi', ENDPOINT_TYPE.OPENAI_RESPONSES, 'gpt-image-1')
    const result = await generateImage<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      buildSdkImageOptions(request({ quality: 'high', background: 'transparent' }), sdkConfig, undefined)
    )
    expect(await requests[0].json()).toMatchObject({ quality: 'high', background: 'transparent' })
    expect(result.images[0].base64).toBe(PNG)
  })

  it('preserves call headers and uses SDK multipart input for GPT image edits', async () => {
    const { sdkConfig } = await configuration('openai', ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, 'gpt-image-1')
    await generateImage<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      buildSdkImageOptions(
        request(
          {},
          { inputImages: [`data:image/png;base64,${PNG}`], requestOptions: { headers: { 'X-Image-Call': 'one' } } }
        ),
        sdkConfig,
        undefined
      )
    )
    expect(requests[0].url).toBe('https://image.example/v1/images/edits')
    expect(requests[0].headers.get('X-Image-Call')).toBe('one')
    expect(requests[0].headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    const body = await requests[0].formData()
    const input = body.get('image')
    if (!(input instanceof File)) throw new Error('Missing multipart image input')
    expect(Buffer.from(await input.arrayBuffer()).toString('base64')).toBe(PNG)
  })

  it('leaves batch splitting and per-call usage with the SDK and preserves its warnings', async () => {
    const { sdkConfig } = await configuration('openai', ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, 'dall-e-3')
    const onProviderCall = vi.fn()
    const result = await generateImage<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
      ...buildSdkImageOptions(request({ numImages: 3, seed: 0 }), sdkConfig, undefined),
      onProviderCall
    })
    expect(result.images).toHaveLength(3)
    expect(requests).toHaveLength(3)
    expect(await Promise.all(requests.map((entry) => entry.json()))).toEqual([
      expect.objectContaining({ n: 1 }),
      expect.objectContaining({ n: 1 }),
      expect.objectContaining({ n: 1 })
    ])
    expect(onProviderCall.mock.calls.map(([event]) => event.imageCount)).toEqual([1, 1, 1])
    expect(result.warnings).toContainEqual(expect.objectContaining({ type: 'unsupported', feature: 'seed' }))
  })
})
