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
  >
> & { background?: string; moderation?: string }

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
    moderation
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
    case 'newapi':
    case 'aihubmix': {
      const mapped = define({ quality, background, moderation })
      return Object.keys(mapped).length ? { openai: mapped, [rawProviderId]: mapped } : {}
    }

    // Google Imagen — `@ai-sdk/google` image model reads `providerOptions.google`.
    case 'google':
    case 'google-vertex': {
      const mapped = define({ personGeneration: personGeneration as JSONValue | undefined })
      return Object.keys(mapped).length ? { google: mapped } : {}
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
