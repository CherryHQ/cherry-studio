import type { JSONValue } from 'ai'

/**
 * Structural subset of the video params that {@link buildVideoProviderOptions} reads.
 *
 * The AI SDK standardizes only `prompt` + a single start-frame `image` plus the scalar
 * top-level fields (`aspectRatio`/`resolution`/`duration`/`fps`/`seed`/`n`). Everything
 * else a video model accepts — `negativePrompt`, `personGeneration`, reference images,
 * camera/motion controls, etc. — has no standard field and must ride in
 * `providerOptions[<providerId>]`. This mapper turns the canonical long-tail params into
 * each vendor's real field names (mirroring `buildImageProviderOptions`).
 */
export interface VideoOptionParams {
  negativePrompt?: string
  personGeneration?: string
  /** Canonical scalar params. Native providers send these top-level (emitter ignores them);
   *  aggregator transports have no top-level params, so their emitter maps them into the bag. */
  aspectRatio?: string
  resolution?: string
  duration?: number
  seed?: number
  /** Vendor-specific bag keyed by provider id, forwarded verbatim (JSON-only). */
  providerOptions?: Record<string, Record<string, unknown>>
}

type ProviderOptions = Record<string, Record<string, JSONValue>>

/** Drop `undefined` / empty-string / `'auto'` entries (`'auto'` is the form "let the provider decide" sentinel). */
function compact(entries: Record<string, JSONValue | undefined>): Record<string, JSONValue> {
  const out: Record<string, JSONValue> = {}
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined && v !== '' && v !== 'auto') out[k] = v
  }
  return out
}

/** Wrap a field map under a single provider key, or `{}` when empty. */
function under(key: string, fields: Record<string, JSONValue>): ProviderOptions {
  return Object.keys(fields).length ? { [key]: fields } : {}
}

/**
 * Forward registry-declared vendor-bag fields the structured params don't cover. The bag
 * may carry non-JSON callbacks that ride the plugin chain (e.g. polling `onProgress`);
 * skip anything not JSON-serializable rather than leaking it into the request body.
 */
function jsonBagFields(bag: Record<string, unknown> | undefined): Record<string, JSONValue> {
  if (!bag) return {}
  const out: Record<string, JSONValue> = {}
  for (const [k, v] of Object.entries(bag)) {
    if (typeof v === 'function' || typeof v === 'symbol' || v === undefined) continue
    out[k] = v as JSONValue
  }
  return out
}

// ── Per-provider emitters ──────────────────────────────────────────────────

type Emitter = (rawProviderId: string, p: VideoOptionParams) => ProviderOptions

/**
 * Google Veo (`@ai-sdk/google.video()`): `GoogleVideoModelOptions` carries `negativePrompt`
 * and `personGeneration` (lowercase enum: `allow_adult`). The registry/UI stores
 * `personGeneration` uppercase (matching `@google/genai`'s enum), so normalize here.
 */
const google: Emitter = (_id, p) =>
  under('google', {
    ...jsonBagFields(p.providerOptions?.google),
    ...compact({
      negativePrompt: p.negativePrompt,
      personGeneration: typeof p.personGeneration === 'string' ? p.personGeneration.toLowerCase() : undefined
    })
  })

/**
 * DMXAPI aggregator: video runs on the job system, so the scalar params go into the vendor bag
 * the transport forwards. Emits CANONICAL names (`aspectRatio`); the per-family `buildSubmitBody`
 * renames them to each vendor's wire field (HappyHorse `ratio` under `parameters`, Vidu
 * `aspect_ratio` flat). The registry vendor bag (`providerOptions.dmxapi`) supplies the rest.
 */
const dmxapi: Emitter = (_id, p) =>
  under('dmxapi', {
    ...jsonBagFields(p.providerOptions?.dmxapi),
    ...compact({ resolution: p.resolution, aspectRatio: p.aspectRatio, duration: p.duration, seed: p.seed })
  })

/**
 * PPIO unified API: flat per-model body. Maps to PPIO's snake_case fields; `duration` is a
 * STRING enum on PPIO. The registry vendor bag (`providerOptions.ppio`) supplies model-specific
 * knobs (prompt_extend, camera_fixed, add_audio, guidance_scale, …).
 */
const ppio: Emitter = (_id, p) =>
  under('ppio', {
    ...jsonBagFields(p.providerOptions?.ppio),
    ...compact({
      resolution: p.resolution,
      aspect_ratio: p.aspectRatio,
      duration: p.duration != null ? String(p.duration) : undefined,
      seed: p.seed,
      negative_prompt: p.negativePrompt
    })
  })

/**
 * AiHubMix (OpenAI-Sora-compatible): `seconds` (string) + `size`. Per-model-family knobs
 * (Kling `mode`/`aspect_ratio`, Seedance `extra_body`, …) ride in `providerOptions.aihubmix`.
 */
const aihubmix: Emitter = (_id, p) =>
  under('aihubmix', {
    ...jsonBagFields(p.providerOptions?.aihubmix),
    ...compact({ seconds: p.duration != null ? String(p.duration) : undefined, size: p.resolution })
  })

/**
 * Fallback for any other provider id: forward the registry vendor bag, then overlay the
 * one canonical field most async video APIs accept (`negative_prompt`, snake_case).
 */
const fallback: Emitter = (id, p) =>
  under(id, { ...jsonBagFields(p.providerOptions?.[id]), ...compact({ negative_prompt: p.negativePrompt }) })

/** Provider id → emitter. Unlisted ids fall through to {@link fallback}. */
const EMITTERS: Record<string, Emitter> = {
  google,
  'google-vertex': google,
  dmxapi,
  ppio,
  aihubmix
}

/**
 * Build AI SDK `providerOptions` for video generation, dispatching over the resolved AI SDK
 * provider id — the mirror of {@link buildImageProviderOptions}. `experimental_generateVideo`
 * passes `providerOptions[<providerId>]` through to the provider as body params.
 */
export function buildVideoProviderOptions(rawProviderId: string, params: VideoOptionParams): ProviderOptions {
  const emitter = EMITTERS[rawProviderId] ?? fallback
  return emitter(rawProviderId, params)
}
