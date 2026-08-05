/**
 * Composed AiHubMix `ImageModelV3`.
 *
 * Upgrades the in-place `createAihubmix().imageModel` from a plain
 * `OpenAICompatibleImageModel` to a model that branches by model id / mode.
 * Google image models are delegated to `@ai-sdk/google`; Ideogram branches
 * are relocated from the bespoke `pages/paintings/providers/aihubmix/generate.ts`.
 * The DEFAULT branch (gpt-image-1/2, FLUX.1-Kontext-pro, and any unknown id)
 * reconstructs the exact inner `OpenAICompatibleImageModel` this provider
 * built before and delegates to it byte-identically — so chat /
 * `ApiService.fetchImageGeneration` is a strict, byte-identical superset
 * regardless of the paintings-page flag.
 *
 * Painting-specific fields and upload blobs are read from
 * `options.providerOptions.aihubmix`. That key is also exactly what the inner
 * `OpenAICompatibleImageModel` reads (`providerOptionsKey` =
 * `'aihubmix.image'.split('.')[0]` = `'aihubmix'`), so a single bag feeds both
 * the special branches and the default delegate.
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import type { ImageModelV3, ImageModelV3CallOptions, JSONValue } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { IMAGE_PARAM_CATALOG_KEYS, type ParamValues, wireName } from '@cherrystudio/provider-registry'
import type { CanonicalParamKey } from '@shared/data/types/model'

import { executeImageTransport } from '../imageTransportRuntime'
import { createAihubmixFluxTransport } from './aihubmixFlux'
import { type AihubmixImageOptions, type AihubmixMode, createAihubmixImageTransport } from './aihubmixImageTransport'

const AIHUBMIX_IMAGE_PROVIDER = 'aihubmix.image' as const
const AIHUBMIX_GOOGLE_PROVIDER = 'aihubmix.google' as const

/** The two Google-image params the wrapper below re-keys into `providerOptions.google`. */
type AihubmixGoogleImageParams = Pick<ParamValues, 'personGeneration' | 'imageResolution'>

export interface CreateAihubmixImageModelOptions {
  baseURL: string
  resolveApiKey: () => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
}

function isGoogleImageModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase()
  return normalized.startsWith('imagen-') || (normalized.startsWith('gemini-') && normalized.includes('image'))
}

function isGoogleGeminiImageModel(modelId: string): boolean {
  return modelId.toLowerCase().startsWith('gemini-')
}

function normalizePersonGeneration(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  switch (value.toUpperCase()) {
    case 'ALLOW_ALL':
      return 'allow_all'
    case 'ALLOW_ADULT':
      return 'allow_adult'
    case 'DONT_ALLOW':
      return 'dont_allow'
    default:
      return value
  }
}

function normalizeAspectRatio(value: unknown): `${number}:${number}` | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/^ASPECT_/i, '').replace('_', ':')
  return /^\d+:\d+$/.test(normalized) ? (normalized as `${number}:${number}`) : undefined
}

const CANONICAL_KEYS = new Set<string>(IMAGE_PARAM_CATALOG_KEYS)

/**
 * The aihubmix gateway expects vendor wire field names (`safety_tolerance`,
 * `size`, …); the renderer emits canonical camelCase in `providerOptions.aihubmix`.
 * Rename each canonical key to its catalog `wireName` so the inner
 * `OpenAICompatibleImageModel`'s "spread bag into body" produces the wire shape.
 * The single `wireName` source replaces the bespoke snake-case map (the renames
 * were proven equal in wireName.test.ts). Non-canonical keys pass through.
 */
function wireNameAihubmixBag(
  providerOptions: ImageModelV3CallOptions['providerOptions']
): ImageModelV3CallOptions['providerOptions'] {
  if (!providerOptions?.aihubmix) return providerOptions
  const aihubmix = providerOptions.aihubmix as Record<string, JSONValue>
  const renamed: Record<string, JSONValue> = {}
  for (const [key, value] of Object.entries(aihubmix)) {
    const wireKey = CANONICAL_KEYS.has(key) ? wireName(key as CanonicalParamKey) : key
    renamed[wireKey] = value
  }
  return { ...providerOptions, aihubmix: renamed }
}

function normalizeImageSize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.toUpperCase()
  return ['512', '1K', '2K', '4K'].includes(normalized) ? normalized : undefined
}

function withAihubmixGoogleImageOptions(model: ImageModelV3, isGeminiImage: boolean): ImageModelV3 {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    maxImagesPerCall: model.maxImagesPerCall,
    doGenerate(options) {
      const providerOptions = options.providerOptions ?? {}
      const bag = (providerOptions.aihubmix ?? {}) as AihubmixGoogleImageParams

      // One canonical read per param, not a spelling probe. The bag under `aihubmix` is
      // `WIRE_REGISTRY.aihubmix` with `passthrough: true` — raw canonical camelCase, no
      // snake_case conversion — and the IPC boundary strips every non-catalog key. So
      // `aspect_ratio` / `person_generation` / `imageSize` / `image_size` could never
      // arrive, and `providerOptions.openai` is the `dualOpenAI` mirror of the profile's
      // mapped fields (quality/background/moderation/style/seed), which never carries
      // these either. Probing those spellings only hid which one was real.
      //
      // `aspectRatio` is a native binding, so it reaches `options.aspectRatio` and never
      // the bag; `size` is the fallback for models that express the ratio that way.
      const aspectRatio = options.aspectRatio ?? normalizeAspectRatio(options.size)
      const personGeneration = normalizePersonGeneration(bag.personGeneration)
      const imageSize = normalizeImageSize(bag.imageResolution)

      const googleOptions: Record<string, unknown> = {
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(personGeneration ? { personGeneration } : {})
      }

      if (isGeminiImage && (aspectRatio || imageSize)) {
        googleOptions.imageConfig = {
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(imageSize ? { imageSize } : {})
        }
      }

      return model.doGenerate({
        ...options,
        ...(aspectRatio ? { aspectRatio, size: undefined } : {}),
        providerOptions: {
          ...providerOptions,
          google: googleOptions as Record<string, JSONValue>
        }
      })
    }
  }
}

/**
 * BFL async FLUX models on aihubmix — delegated to `./aihubmixFlux.ts`.
 *
 * Three vendor ids submit a task and poll for the final URL (the rest of
 * the FLUX family stays on the sync OpenAI-compat default branch).
 */
const ASYNC_FLUX_MODELS = new Set(['flux-2-flex', 'flux-2-pro', 'flux-kontext-max'])

export function createAihubmixImageModel(modelId: string, opts: CreateAihubmixImageModelOptions): ImageModelV3 {
  const { baseURL, resolveApiKey, headers, fetch: customFetch } = opts

  // Provider `baseURL` already includes the OpenAI-compat `/v1` suffix
  // (default `https://aihubmix.com/v1`; painting passes
  // `formatApiHost(provider.apiHost)` which appends `/v1`). The bespoke
  // service used `provider.apiHost` (the host root) for the gemini / ideogram
  // special endpoints, so strip the `/v1` suffix to reproduce those URLs.
  const apiRoot = baseURL.replace(/\/v1\/?$/, '')

  const fetchImpl: FetchFunction = customFetch ?? globalThis.fetch

  if (isGoogleImageModel(modelId)) {
    const googleProvider = createGoogleGenerativeAI({
      apiKey: resolveApiKey(),
      baseURL: `${apiRoot}/gemini/v1beta`,
      headers: headers(),
      fetch: fetchImpl,
      name: AIHUBMIX_GOOGLE_PROVIDER
    })
    return withAihubmixGoogleImageOptions(
      googleProvider.image(modelId, { maxImagesPerCall: 10 }),
      isGoogleGeminiImageModel(modelId)
    )
  }

  const doGenerate = async (
    options: ImageModelV3CallOptions
  ): Promise<Awaited<ReturnType<ImageModelV3['doGenerate']>>> => {
    const bag = (options.providerOptions?.aihubmix ?? {}) as unknown as AihubmixImageOptions
    const mode: AihubmixMode = bag.mode ?? 'generate'
    const prompt = options.prompt ?? ''
    const abortSignal = options.abortSignal
    const currentDate = new Date()

    const wrap = (images: string[]) => ({
      images,
      warnings: [],
      response: { timestamp: currentDate, modelId, headers: {} }
    })

    // Canonical AI-SDK options. Renderer's canonicalGenerate routes:
    //   painting.params.aspectRatio → options.aspectRatio
    //   painting.params.numImages   → options.n
    //   painting.params.seed        → options.seed (or bag.seed for non-native)
    // Vendor-specific keys (styleType / magicPromptOption / renderingSpeed
    // / etc.) flow through `bag`.
    const aspectRatio = options.aspectRatio ?? (typeof bag.aspectRatio === 'string' ? bag.aspectRatio : undefined)
    const numImages = options.n ?? bag.numImages ?? 1

    // ---- BFL async FLUX branch (flux-2-flex / flux-2-pro / flux-kontext-max) ----
    // Submit task + poll. `aspectRatio` travels on the typed submit field, not stamped
    // into the bag as `aspect_ratio` — the transport's spelling is declared now.
    if (ASYNC_FLUX_MODELS.has(modelId)) {
      const transport = createAihubmixFluxTransport({
        apiRoot,
        apiKey: resolveApiKey(),
        headers: headers(),
        fetch: customFetch
      })
      const urls = await executeImageTransport({
        transport,
        input: {
          modelId,
          prompt,
          n: numImages,
          size: options.size,
          aspectRatio,
          seed: typeof options.seed === 'number' ? options.seed : undefined,
          files: options.files,
          mask: options.mask,
          providerParams: {
            safetyTolerance: typeof bag.safetyTolerance === 'number' ? bag.safetyTolerance : undefined
          },
          headers: options.headers,
          signal: abortSignal
        },
        onTaskSubmitted: async () => {},
        onProgress: () => {},
        logContext: { provider: AIHUBMIX_IMAGE_PROVIDER, modelId }
      })
      return wrap(urls)
    }

    // ---- Bespoke AiHubMix HTTP families ----
    // The adapter selects the family; endpoint/body/response handling lives in
    // the transport so no custom branch performs HTTP here.
    if (modelId === 'V_3' || modelId.startsWith('doubao-seedream') || !isDefaultModel(modelId, mode)) {
      const transport = createAihubmixImageTransport({
        apiRoot,
        baseURL,
        apiKey: resolveApiKey(),
        headers: headers(),
        fetch: customFetch
      })
      const urls = await executeImageTransport({
        transport,
        input: {
          modelId,
          prompt,
          n: numImages,
          size: options.size,
          aspectRatio,
          seed: options.seed,
          files: options.files,
          mask: options.mask,
          providerParams: bag,
          headers: options.headers,
          signal: abortSignal
        },
        onTaskSubmitted: async () => {},
        onProgress: () => {},
        logContext: { provider: AIHUBMIX_IMAGE_PROVIDER, modelId }
      })
      return wrap(urls)
    }

    // ---- DEFAULT: reconstruct the inner OpenAICompatibleImageModel byte-identically ----
    // gpt-image-1/2, FLUX.1-Kontext-pro, and any unknown id in `generate` mode.
    // The inner `OpenAICompatibleImageModel` POSTs `/images/generations` and
    // spreads `providerOptions.aihubmix` into the body. FLUX expects
    // `safety_tolerance`; renderer emits canonical camelCase
    // `safetyTolerance`. Rename camelCase → snake_case before delegating so
    // the gateway sees the wire-format the bespoke service produced.
    if (isDefaultModel(modelId, mode)) {
      const inner = new OpenAICompatibleImageModel(modelId, {
        provider: AIHUBMIX_IMAGE_PROVIDER,
        url: ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`,
        headers,
        fetch: customFetch
      })
      return inner.doGenerate({ ...options, providerOptions: wireNameAihubmixBag(options.providerOptions) })
    }

    throw new Error(`Unreachable AiHubMix image route for '${modelId}'`)
  }

  return {
    specificationVersion: 'v3',
    provider: AIHUBMIX_IMAGE_PROVIDER,
    modelId,
    maxImagesPerCall: 10,
    doGenerate
  }
}

// Ideogram V_1/V_2 model ids: the only non-default models that take the
// bespoke `${apiRoot}/ideogram/...` JSON/FormData path in `generate` mode.
// (V_3 is handled by its own branch above.)
const IDEOGRAM_V1_V2_MODELS = new Set(['V_1', 'V_2'])

/**
 * Default models flow through the inner `OpenAICompatibleImageModel`:
 * gpt-image-1/2, FLUX.1-Kontext-pro, and any other / unknown id in
 * `generate` mode. Only the Ideogram V_1/V_2 ids take the bespoke Ideogram
 * JSON path; remix/upscale never default (they always take the bespoke
 * Ideogram FormData path). This keeps chat / `ApiService.fetchImageGeneration`
 * (which sends arbitrary model ids in generate mode) byte-identical to the
 * pre-Phase-4a `OpenAICompatibleImageModel`.
 */
function isDefaultModel(modelId: string, mode: AihubmixMode): boolean {
  // NOTE: `mode` is always `'generate'` today. It is read from
  // `providerOptions.aihubmix.mode`, which is v1 residue — not a catalog key, so the IPC
  // boundary strips it, and nothing in the v2 path writes it. That makes this guard, and
  // the `remix` / `upscale` branches in `createAihubmixImageModel`, unreachable. v2
  // carries the mode as `request.mode` → `modelDescriptor.mode`, not through the param
  // bag; wiring those branches to it — and their `bag.imageFiles` reads to
  // `options.files` — is the fix, not a rename.
  if (mode !== 'generate') {
    return false
  }
  return !IDEOGRAM_V1_V2_MODELS.has(modelId)
}
