import type { VideoParamValues } from '@cherrystudio/provider-registry'
import type { CanonicalVideoParamKey } from '@shared/data/types/model'
import type { JSONValue } from 'ai'

import { normalizeAspectRatio } from './aiSdkNativeBindings'

/**
 * Video counterpart of `splitParamValues` (imageOptions.ts): partition the
 * IPC-validated canonical `paramValues` bag into
 *
 * - `native` — the AI SDK `generateVideo` top-level call options
 *   (`duration` / `aspectRatio` / `resolution` / `fps` / `seed`), with
 *   `aspectRatio` normalized once (`ASPECT_X_Y → X:Y`), and
 * - `vendor` — everything else, handed to the {@link buildVideoProviderOptions}
 *   emitters. Emitters that need a native scalar in the vendor body (the
 *   aggregator transports have no top-level params) read it from `native`.
 *
 * Blank (`''`), `null`/`undefined`, and `'auto'` values are dropped here —
 * `'auto'` is the form's "let the provider decide" sentinel — so the server
 * applies its own default; no client-side defaults.
 */

/** The AI SDK `generateVideo` native scalar params. */
export interface NativeVideoParams {
  duration?: number
  aspectRatio?: string
  resolution?: string
  fps?: number
  seed?: number
}

const NATIVE_VIDEO_KEYS = new Set<CanonicalVideoParamKey>(['duration', 'aspectRatio', 'resolution', 'fps', 'seed'])

export interface SplitVideoParams {
  readonly native: NativeVideoParams
  /** Non-native canonical keys (negativePrompt, cameraFixed, cfg, …), cleaned. */
  readonly vendor: VideoParamValues
}

function isOmitted(value: unknown): boolean {
  return value === undefined || value === null || value === '' || value === 'auto'
}

export function splitVideoParamValues(paramValues: VideoParamValues): SplitVideoParams {
  const native: Record<string, unknown> = {}
  const vendor: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(paramValues)) {
    if (isOmitted(value)) continue
    if (NATIVE_VIDEO_KEYS.has(key as CanonicalVideoParamKey)) {
      const mapped = key === 'aspectRatio' ? normalizeAspectRatio(typeof value === 'string' ? value : undefined) : value
      if (!isOmitted(mapped)) native[key] = mapped
    } else {
      vendor[key] = value
    }
  }
  return { native: native as NativeVideoParams, vendor: vendor as VideoParamValues }
}

type ProviderOptions = Record<string, Record<string, JSONValue>>

/** Drop omitted entries (mirror of the split's cleaning, for emitter-built maps). */
function compact(entries: Record<string, JSONValue | undefined>): Record<string, JSONValue> {
  const out: Record<string, JSONValue> = {}
  for (const [k, v] of Object.entries(entries)) {
    if (!isOmitted(v)) out[k] = v as JSONValue
  }
  return out
}

/** Wrap a field map under a single provider key, or `{}` when empty. */
function under(key: string, fields: Record<string, JSONValue>): ProviderOptions {
  return Object.keys(fields).length ? { [key]: fields } : {}
}

/**
 * The vendor long tail minus the keys an emitter maps explicitly. Keys stay
 * canonical (camelCase) — vendors with their own spelling rename in their
 * emitter (ppio) or transport (`dmxapi.buildSubmitBody`).
 */
function longTail(vendor: VideoParamValues, ...mapped: CanonicalVideoParamKey[]): Record<string, JSONValue> {
  const out: Record<string, JSONValue> = {}
  for (const [k, v] of Object.entries(vendor)) {
    if (v === undefined || mapped.includes(k as CanonicalVideoParamKey)) continue
    out[k] = v as JSONValue
  }
  return out
}

// ── Per-provider emitters ──────────────────────────────────────────────────

type Emitter = (rawProviderId: string, p: SplitVideoParams) => ProviderOptions

/**
 * Google Veo (`@ai-sdk/google.video()`): `GoogleVideoModelOptions` carries `negativePrompt`
 * and `personGeneration` (lowercase enum: `allow_adult`). The registry/UI stores
 * `personGeneration` uppercase (matching `@google/genai`'s enum), so normalize here.
 * Native scalars ride top-level on the SDK call, not here.
 */
const google: Emitter = (_id, p) =>
  under('google', {
    ...longTail(p.vendor, 'negativePrompt', 'personGeneration'),
    ...compact({
      negativePrompt: p.vendor.negativePrompt,
      personGeneration: p.vendor.personGeneration?.toLowerCase()
    })
  })

/**
 * DMXAPI aggregator: video runs on the job system, so the scalar params go into the vendor bag
 * the transport forwards. Emits CANONICAL names (`aspectRatio`); the per-family `buildSubmitBody`
 * renames them to each vendor's wire field (HappyHorse `ratio` under `parameters`, Vidu
 * `aspect_ratio` flat). `negativePrompt` has no DMXAPI wire field, so it is excluded.
 */
const dmxapi: Emitter = (_id, p) =>
  under('dmxapi', {
    ...longTail(p.vendor, 'negativePrompt'),
    ...compact({
      resolution: p.native.resolution,
      aspectRatio: p.native.aspectRatio,
      duration: p.native.duration,
      seed: p.native.seed
    })
  })

/**
 * PPIO unified API: flat per-model body. Maps to PPIO's snake_case fields; `duration` is a
 * STRING enum on PPIO. Model-specific knobs (camera_fixed, prompt_extend, …) are the canonical
 * long tail renamed to PPIO's spelling.
 */
const ppio: Emitter = (_id, p) =>
  under('ppio', {
    ...longTail(p.vendor, 'negativePrompt', 'cameraFixed', 'promptExtend'),
    ...compact({
      resolution: p.native.resolution,
      aspect_ratio: p.native.aspectRatio,
      duration: p.native.duration != null ? String(p.native.duration) : undefined,
      seed: p.native.seed,
      negative_prompt: p.vendor.negativePrompt,
      camera_fixed: p.vendor.cameraFixed,
      prompt_extend: p.vendor.promptExtend
    })
  })

/**
 * AiHubMix (OpenAI-Sora-compatible): `seconds` (string) + `size`. Per-model-family knobs
 * (Kling `mode`/`aspect_ratio`, Seedance `extra_body`, …) ride the canonical long tail.
 */
const aihubmix: Emitter = (_id, p) =>
  under('aihubmix', {
    ...longTail(p.vendor, 'negativePrompt'),
    ...compact({
      seconds: p.native.duration != null ? String(p.native.duration) : undefined,
      size: p.native.resolution
    })
  })

/**
 * Fallback for any other provider id: forward the canonical long tail, then overlay the
 * one canonical field most async video APIs accept (`negative_prompt`, snake_case).
 */
const fallback: Emitter = (id, p) =>
  under(id, { ...longTail(p.vendor, 'negativePrompt'), ...compact({ negative_prompt: p.vendor.negativePrompt }) })

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
 * provider id — the mirror of the image path's `buildVendorProviderOptions`.
 * `experimental_generateVideo` passes `providerOptions[<providerId>]` through to the provider
 * as body params.
 */
export function buildVideoProviderOptions(rawProviderId: string, params: SplitVideoParams): ProviderOptions {
  const emitter = EMITTERS[rawProviderId] ?? fallback
  return emitter(rawProviderId, params)
}
