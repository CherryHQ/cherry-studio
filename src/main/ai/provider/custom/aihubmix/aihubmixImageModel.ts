import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import type { ImageModelV3, ImageModelV3CallOptions, JSONValue } from '@ai-sdk/provider'
import { type FetchFunction, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { IMAGE_PARAM_CATALOG_KEYS, wireName } from '@cherrystudio/provider-registry'

import { parseImageVendorParams } from '../../../utils/imageOptions'
import { unsupportedTransportInputs } from '../imageGenerationModel'
import { executeImageTransport } from '../imageTransportRuntime'
import { createAihubmixFluxTransport } from './aihubmixFlux'
import type { AihubmixImageBinding } from './aihubmixImageBinding'
import { createAihubmixImageTransport } from './aihubmixImageTransport'

const PROVIDER = 'aihubmix.image'

export interface CreateAihubmixImageModelOptions {
  baseURL: string
  resolveApiKey: () => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
  binding: AihubmixImageBinding
}

function wireOptions(options: ImageModelV3CallOptions): ImageModelV3CallOptions['providerOptions'] {
  const params = parseImageVendorParams(options.providerOptions.aihubmix ?? {})
  const aihubmix: Record<string, JSONValue> = {}
  for (const key of IMAGE_PARAM_CATALOG_KEYS) {
    const value = params[key]
    if (value !== undefined) aihubmix[wireName(key)] = value
  }
  return { ...options.providerOptions, aihubmix }
}

function googleImageModel(modelId: string, opts: CreateAihubmixImageModelOptions): ImageModelV3 {
  const google = createGoogleGenerativeAI({
    apiKey: opts.resolveApiKey(),
    baseURL: opts.baseURL,
    headers: opts.headers(),
    fetch: opts.fetch,
    name: 'aihubmix.google'
  }).image(modelId, { maxImagesPerCall: 10 })
  return {
    specificationVersion: google.specificationVersion,
    provider: google.provider,
    modelId,
    maxImagesPerCall: google.maxImagesPerCall,
    async doGenerate(options) {
      const bag = parseImageVendorParams(options.providerOptions.aihubmix ?? {})
      const aspectRatio = options.aspectRatio
      const personGeneration = bag.personGeneration?.toLowerCase()
      const imageSize = bag.imageResolution?.toUpperCase()
      const googleOptions: Record<string, JSONValue> = {
        ...(aspectRatio && { aspectRatio }),
        ...(personGeneration && { personGeneration })
      }
      if (opts.binding.kind === 'google-gemini' && (aspectRatio || imageSize)) {
        googleOptions.imageConfig = {
          ...(aspectRatio && { aspectRatio }),
          ...(imageSize && { imageSize })
        }
      }
      return google.doGenerate({
        ...options,
        ...(aspectRatio && { aspectRatio, size: undefined }),
        providerOptions: { ...options.providerOptions, google: googleOptions }
      })
    }
  }
}

/** SDK conversion only: protocol selection is complete before this model is constructed. */
export function createAihubmixImageModel(modelId: string, opts: CreateAihubmixImageModelOptions): ImageModelV3 {
  const { binding } = opts
  if (binding.kind === 'google-imagen' || binding.kind === 'google-gemini') return googleImageModel(modelId, opts)
  if (binding.kind === 'openai') {
    const inner = new OpenAICompatibleImageModel(modelId, {
      provider: PROVIDER,
      url: ({ path }) => `${withoutTrailingSlash(opts.baseURL)}${path}`,
      headers: opts.headers,
      fetch: opts.fetch
    })
    return {
      specificationVersion: inner.specificationVersion,
      provider: inner.provider,
      modelId,
      maxImagesPerCall: inner.maxImagesPerCall,
      doGenerate: async (options) => inner.doGenerate({ ...options, providerOptions: wireOptions(options) })
    }
  }

  const settings = {
    apiRoot: opts.baseURL.replace(/\/v1\/?$/, ''),
    baseURL: opts.baseURL,
    apiKey: opts.resolveApiKey(),
    headers: opts.headers(),
    fetch: opts.fetch
  }
  const transport =
    binding.kind === 'flux'
      ? createAihubmixFluxTransport(settings)
      : createAihubmixImageTransport({ ...settings, binding })
  return {
    specificationVersion: 'v3',
    provider: PROVIDER,
    modelId,
    maxImagesPerCall: 10,
    async doGenerate(options) {
      const input = {
        modelId,
        prompt: options.prompt,
        n: options.n,
        size: options.size,
        aspectRatio: options.aspectRatio,
        seed: options.seed,
        files: options.files,
        mask: options.mask,
        providerParams: parseImageVendorParams(options.providerOptions.aihubmix ?? {}),
        headers: options.headers,
        signal: options.abortSignal
      }
      const warnings = unsupportedTransportInputs(transport, input).map((feature) => ({
        type: 'unsupported' as const,
        feature
      }))
      const timestamp = new Date()
      const images = await executeImageTransport({
        transport,
        input,
        onTaskSubmitted: async () => {},
        onProgress: () => {},
        logContext: { provider: PROVIDER, modelId }
      })
      return { images, warnings, response: { timestamp, modelId, headers: {} } }
    }
  }
}
