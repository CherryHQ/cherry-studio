import { fileURLToPath } from 'node:url'

import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { formatApiHost } from '@shared/utils/api'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import { splitParamValues } from '../../utils/imageOptions'
import { buildVendorProviderOptions } from '../custom/wire/buildImageRequest'
import { DEFAULT_DIFFUSION_REGISTRATION, WIRE_REGISTRY } from '../custom/wire/wireProfile'
import { resolveAiSdkProviderId, resolveEffectiveEndpoint, resolveWireModelId } from '../endpoint'

const dataDir = new URL('../../../../../packages/provider-registry/data/', import.meta.url)
const loader = new RegistryLoader({
  models: fileURLToPath(new URL('models.json', dataDir)),
  providers: fileURLToPath(new URL('providers.json', dataDir)),
  providerModels: fileURLToPath(new URL('provider-models.json', dataDir))
})

// Exercise the same canonical bag, wire registration and installed SDK used by AiService.
describe('GPT Image 2.6 OpenAI requests', () => {
  for (const variant of ['flare', 'sunburst']) {
    it.each(['generate', 'edit'] as const)(`${variant} sends the official %s request`, async (mode) => {
      const apiModelId = `gpt-image-2.6-${variant}`
      const offer = loader.findOverride('openai', apiModelId)
      expect(offer?.apiModelId).toBe(apiModelId)
      const preset = loader.findProvider('openai')
      if (!preset || !offer?.apiModelId) throw new Error('Missing official image model offer')
      const runtimeProvider = makeProvider({
        id: 'openai',
        presetProviderId: 'openai',
        defaultChatEndpoint: preset.defaultChatEndpoint ?? undefined,
        endpointConfigs: preset.endpointConfigs
      })
      const model = makeModel({
        id: `openai::${apiModelId}`,
        providerId: 'openai',
        apiModelId: offer.apiModelId,
        endpointTypes: offer.endpointTypes
      })
      const endpoint = resolveEffectiveEndpoint(runtimeProvider, model)
      const sdkProviderId = resolveAiSdkProviderId(runtimeProvider, endpoint.endpointType)
      expect(sdkProviderId).toBe('openai')
      expect(endpoint.baseUrl).toBe('https://api.openai.com')
      const params = { quality: 'low', size: '1536x1024', numImages: 2, background: 'transparent' }
      const { structured, vendorBag } = splitParamValues(params)
      const providerOptions = buildVendorProviderOptions(
        sdkProviderId,
        params,
        WIRE_REGISTRY[sdkProviderId] ?? DEFAULT_DIFFUSION_REGISTRATION,
        vendorBag
      )
      const requests: Request[] = []
      const provider = createOpenAI({
        apiKey: 'local-test-key',
        baseURL: formatApiHost(endpoint.baseUrl),
        fetch: async (input, init) => {
          requests.push(new Request(input, init))
          return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), {
            headers: { 'content-type': 'application/json' }
          })
        }
      })
      const result = await provider.imageModel(resolveWireModelId(model, endpoint.endpointType)).doGenerate({
        prompt: 'a tiny orange sun',
        n: structured.n!,
        size: structured.size as `${number}x${number}`,
        aspectRatio: undefined,
        seed: undefined,
        files: mode === 'edit' ? [{ type: 'file', mediaType: 'image/png', data: 'QUJD' }] : undefined,
        mask: undefined,
        providerOptions
      })
      expect(requests).toHaveLength(1)
      const request = requests[0]
      expect(request.method).toBe('POST')
      expect(request.url).toBe(`https://api.openai.com/v1/images/${mode === 'edit' ? 'edits' : 'generations'}`)
      if (mode === 'generate') {
        expect(await request.json()).toEqual({
          model: apiModelId,
          prompt: 'a tiny orange sun',
          n: 2,
          size: '1536x1024',
          quality: 'low',
          background: 'transparent'
        })
      } else {
        const body = await request.formData()
        expect(body.get('model')).toBe(apiModelId)
        expect(body.get('prompt')).toBe('a tiny orange sun')
        expect(body.get('n')).toBe('2')
        expect(body.get('size')).toBe('1536x1024')
        expect(body.get('quality')).toBe('low')
        expect(body.get('background')).toBe('transparent')
        const image = body.get('image')
        expect(image).toBeInstanceOf(File)
        if (!(image instanceof File)) throw new Error('Missing image upload')
        expect(image.type).toBe('image/png')
        expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([65, 66, 67]))
        expect(body.has('input_fidelity')).toBe(false)
      }
      expect(result.images).toEqual(['QUJD'])
    })
  }
  it.each(['flare', 'sunburst'])(
    '%s forwards animation settings through the canonical request path',
    async (variant) => {
      const { vendorBag } = splitParamValues({
        outputFormat: 'gif',
        frameCount: 9,
        frameDurationMs: 200,
        complexity: 'low'
      })
      const providerOptions = buildVendorProviderOptions('openai', vendorBag, WIRE_REGISTRY.openai, vendorBag)
      const bodies: unknown[] = []
      const model = createOpenAI({
        apiKey: 'fixture',
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(init?.body as string))
          return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), {
            headers: { 'content-type': 'application/json' }
          })
        }
      }).imageModel(`gpt-image-2.6-${variant}`)
      await model.doGenerate({
        prompt: 'a bouncing sun',
        n: 1,
        size: '1024x1024',
        aspectRatio: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerOptions
      })
      expect(bodies).toEqual([
        {
          model: `gpt-image-2.6-${variant}`,
          prompt: 'a bouncing sun',
          n: 1,
          size: '1024x1024',
          output_format: 'gif',
          frame_count: 9,
          frame_duration_ms: 200,
          complexity: 'low'
        }
      ])
    }
  )

  it('omits stale animation timing when output switches back to PNG', () => {
    const params = { outputFormat: 'png', frameCount: 9, frameDurationMs: 200, complexity: 'high' }
    const { vendorBag } = splitParamValues(params)
    expect(buildVendorProviderOptions('openai', params, WIRE_REGISTRY.openai, vendorBag)).toEqual({
      openai: { outputFormat: 'png', complexity: 'high' }
    })
  })
})
