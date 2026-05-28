import type { GenerateImageParams } from '@renderer/types'
import type { JSONValue } from 'ai'

/**
 * Structural subset of the image params that {@link buildImageProviderOptions}
 * actually reads. Both `GenerateImageParams` and `EditImageParams` satisfy this,
 * so generate and edit can share one mapper. `background`/`moderation` are real
 * OpenAI image-body fields consumed by the unified newapi/cherryin/aionly path.
 */
export type ImageOptionParams = Partial<
  Pick<
    GenerateImageParams,
    | 'negativePrompt'
    | 'seed'
    | 'numInferenceSteps'
    | 'guidanceScale'
    | 'promptEnhancement'
    | 'personGeneration'
    | 'quality'
    | 'aspectRatio'
    | 'imageSize'
  >
> & { background?: string; moderation?: string; style?: string }

/**
 * Normalize the painting form's `ASPECT_X_Y` enum (or already-normalized
 * `X:Y`) into the `${number}:${number}` shape Google/Imagen/Gemini-image
 * accept. Returns `undefined` for non-strings or mismatched values so the
 * caller can omit the field entirely.
 */
function normalizeAspectRatio(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const stripped = value.replace(/^ASPECT_/i, '').replace('_', ':')
  return /^\d+:\d+$/.test(stripped) ? stripped : undefined
}

/**
 * Build AI SDK `providerOptions` for image generation, mirroring the chat-side
 * `buildProviderOptions` idiom (switch over the resolved AI SDK provider id).
 *
 * Why this exists: `AiProvider.modernGenerateImage` historically forwarded only
 * `prompt/size/n/abortSignal` and silently dropped `negativePrompt/seed/
 * numInferenceSteps/guidanceScale/promptEnhancement/personGeneration/quality`.
 * AI SDK image models spread `providerOptions[<providerOptionsKey>]` verbatim
 * into the request body (`@ai-sdk/openai-compatible` `OpenAICompatibleImageModel`
 * via `getArgs`; `@ai-sdk/openai` `OpenAIImageModel` via `providerOptions.openai`),
 * so this maps the painting params to each provider's real image-API field
 * names and returns them keyed by the resolved provider id.
 *
 * `rawProviderId` is `providerConfig.providerId` (== `getAiSdkProviderId(...)`),
 * which is the provider name the executor registered — i.e. the key
 * `OpenAICompatibleImageModel.providerOptionsKey` reads.
 */
export function buildImageProviderOptions(
  rawProviderId: string,
  params: ImageOptionParams
): Record<string, Record<string, JSONValue>> {
  const {
    negativePrompt,
    seed,
    numInferenceSteps,
    guidanceScale,
    promptEnhancement,
    personGeneration,
    quality,
    background,
    moderation,
    style,
    aspectRatio,
    imageSize
  } = params

  const seedNumber = seed && /^-?\d+$/.test(seed.trim()) ? Number(seed.trim()) : undefined

  // `'auto'` is the painting UI sentinel for "let the provider decide" — it must
  // not be forwarded as a literal body value (the bespoke newapi path omitted it).
  const define = (entries: Record<string, JSONValue | undefined>): Record<string, JSONValue> => {
    const out: Record<string, JSONValue> = {}
    for (const [k, v] of Object.entries(entries)) {
      if (v !== undefined && v !== '' && v !== 'auto') out[k] = v
    }
    return out
  }

  switch (rawProviderId) {
    // OpenAI image family — `OpenAIImageModel` reads `providerOptions.openai`;
    // `OpenAICompatibleImageModel` (newapi) reads `providerOptions[<name>]` (its
    // provider name is `newapi`). `quality`/`background`/`moderation` are the real
    // OpenAI image-body fields (`seed` is explicitly unsupported, warned by the
    // model). The dual `{ openai, [rawProviderId] }` shape feeds whichever key the
    // resolved model reads (cherryin → `openai`, newapi/aionly-via-newapi → `newapi`).
    case 'openai':
    case 'openai-chat':
    case 'azure':
    case 'azure-responses':
    case 'huggingface':
    case 'cherryin':
    case 'newapi': {
      const mapped = define({ quality, background, moderation, style })
      return Object.keys(mapped).length ? { openai: mapped, [rawProviderId]: mapped } : {}
    }

    // aihubmix aggregates many backends (Doubao Seedream / Qwen-Image / FLUX /
    // iRAG / Ideogram) — most of these accept `seed` in the body. OpenAI's
    // image model would warn-and-drop seed if we left it on the positional
    // AI SDK field, so route it through the provider bag too.
    case 'aihubmix': {
      const mapped = define({ quality, background, moderation, style, seed: seedNumber })
      return Object.keys(mapped).length ? { openai: mapped, [rawProviderId]: mapped } : {}
    }

    // Google native image — `@ai-sdk/google.image()` dispatches by model id:
    //   Imagen path  → top-level `aspectRatio` is read directly from the SDK
    //                  call options (AiProvider passes it normalized).
    //   Gemini image → reads `providerOptions.google.imageConfig.{aspectRatio,
    //                  imageSize}` (its initial `imageConfig: { aspectRatio }`
    //                  is overridden by the spread of providerOptions.google).
    // We build the imageConfig here so Nano Banana / Nano Banana Pro pick up
    // both aspectRatio and the `imageResolution` chip (mapped to imageSize
    // via the registry keyMap). personGeneration is the Imagen-only
    // top-level field; carry it as before.
    case 'google':
    case 'google-vertex': {
      const normalizedAspect = normalizeAspectRatio(aspectRatio)
      const imageConfig: Record<string, JSONValue> = {}
      if (normalizedAspect) imageConfig.aspectRatio = normalizedAspect
      if (typeof imageSize === 'string' && imageSize !== '' && imageSize !== 'auto') {
        imageConfig.imageSize = imageSize
      }
      const googleOptions: Record<string, JSONValue> = {}
      if (Object.keys(imageConfig).length > 0) googleOptions.imageConfig = imageConfig
      const person = define({ personGeneration: personGeneration as JSONValue | undefined })
      Object.assign(googleOptions, person)
      return Object.keys(googleOptions).length ? { google: googleOptions } : {}
    }

    // OpenAI-compatible / diffusion (silicon, zhipu, deepseek, openrouter, …).
    // `OpenAICompatibleImageModel.getArgs` spreads `providerOptions[providerName]`
    // (and its camelCase form) verbatim into the `/images/generations` body, so
    // these must be the providers' real snake_case field names: SiliconFlow
    // (`negative_prompt`/`seed`/`num_inference_steps`/`guidance_scale`/
    // `prompt_enhancement`) and Zhipu CogView (`quality`).
    case 'openai-compatible':
    case 'deepseek':
    case 'openrouter':
    default: {
      const mapped = define({
        negative_prompt: negativePrompt,
        seed: seedNumber,
        num_inference_steps: numInferenceSteps,
        guidance_scale: guidanceScale,
        prompt_enhancement: promptEnhancement,
        quality
      })
      return Object.keys(mapped).length ? { [rawProviderId]: mapped } : {}
    }
  }
}
