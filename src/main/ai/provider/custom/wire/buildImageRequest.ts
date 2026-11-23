import type { JSONObject, JSONValue } from '@ai-sdk/provider'

import { type ParamValues, wireName } from '@cherrystudio/provider-registry'

import type { WireProfile, WireRegistration } from './wireProfile'

function skipValue(value: ParamValues[keyof ParamValues] | null): value is undefined | null | '' | 'auto' {
  return value === undefined || value === '' || value === null || value === 'auto'
}

function isPlainObject(v: JSONValue | undefined): v is JSONObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function setOwnField(body: JSONObject, key: string, value: JSONValue | undefined): void {
  Object.defineProperty(body, key, { value, enumerable: true, configurable: true, writable: true })
}

/**
 * Merge a `contribute()` result into the body: deep-merge nested plain objects
 * (google's `imageConfig` assembled from `aspectRatio` + `size`) and drop empty
 * leaves (`undefined` / `''` / `'auto'`) plus any object that prunes to empty —
 * mirroring the legacy `compact()` so an unset `aspectRatio` leaves no
 * `imageConfig.aspectRatio` and an all-empty block leaves no `imageConfig` key.
 */
function mergeContribution(body: JSONObject, contribution: JSONObject): void {
  for (const [k, v] of Object.entries(contribution)) {
    if (isPlainObject(v)) {
      const previous = Object.hasOwn(body, k) ? body[k] : undefined
      const target = isPlainObject(previous) ? previous : {}
      mergeContribution(target, v)

      if (Object.keys(target).length > 0) setOwnField(body, k, target)
    } else if (v !== undefined && v !== '' && v !== 'auto') {
      setOwnField(body, k, v)
    }
  }
}

/**
 * Map a canonical `paramValues` bag to a vendor request body. `forward` keys ride
 * as `wireName(key) → value` (the catalog supplies the snake_case name — one
 * source, no per-profile rename). `fields` carry explicit overrides: a `to`/`map`
 * rule sets one field, a `contribute` rule merges a partial body (one-to-many /
 * nested). Drops `undefined` / `''` / `null` / `'auto'` — mirroring the old
 * `compact()` so the body is byte-identical. Native params (`n`/`size`/`seed`/
 * `aspectRatio`) are routed elsewhere except where a profile re-declares one in
 * the body (silicon duplicates `seed`; google nests `aspectRatio`/`size`).
 */
export function buildImageRequest(paramValues: ParamValues, profile: WireProfile) {
  const values: Record<string, ParamValues[keyof ParamValues]> = paramValues
  const body: Record<string, JSONValue> = {}

  for (const key of profile.forward ?? []) {
    const value = values[key]

    if (skipValue(value)) continue
    setOwnField(body, wireName(key), value)
  }

  for (const [key, rule] of Object.entries(profile.fields ?? {})) {
    if (!rule) continue
    const value = values[key]

    if (skipValue(value)) continue

    if (rule.contribute) {
      mergeContribution(body, rule.contribute(value, paramValues))
    } else if (rule.to) {
      setOwnField(body, rule.to, rule.map ? rule.map(value, paramValues) : value)
    }
  }

  return body
}

/**
 * Forward vendor-bag fields the profile doesn't map (SiliconFlow Qwen-Image's
 * `cfg`, …). The bag may also carry non-JSON callbacks that ride the plugin chain
 * off-band (the polling `onProgress`). Skip top-level functions, symbols and
 * undefined; remaining values keep their downstream SDK/serialization behavior.
 * Mirrors the legacy `diffusion` emitter's `jsonBagFields` filter.
 */
function jsonBag<T>(bag: Record<string, T>) {
  return Object.fromEntries(
    Object.entries(bag).filter(
      ([, value]) => typeof value !== 'function' && typeof value !== 'symbol' && value !== undefined
    )
  )
}

/** The vendor-bag entries the profile does NOT map (via `forward` or `fields`) —
 *  what `passthrough` forwards. */
function passthroughExtras<T>(vendorBag: Record<string, T>, profile: WireProfile) {
  const mapped = new Set<string>([...(profile.forward ?? []), ...Object.keys(profile.fields ?? {})])

  return Object.fromEntries(Object.entries(vendorBag).filter(([key]) => !mapped.has(key)))
}

/**
 * Build the AI SDK `providerOptions` map for a registered provider: its engine
 * body keyed by the provider id (and `openai` too when `dualOpenAI`). Returns
 * `{}` when the body is empty — matching the legacy emitter's `under()`/
 * `dualOpenAI()` empty-map behavior so the wire stays byte-identical. This is the
 * Layer-3 delivery adapter: it owns *which key(s)* the body rides under + whether
 * unmapped vendor-bag fields pass through — concerns the profile deliberately
 * doesn't carry.
 *
 * `paramValues` supplies the profile-mapped fields (the native-binding-keyed
 * canonical params); `vendorBag` supplies the `passthrough` fields (the
 * non-binding canonical keys `splitParamValues` partitioned out). Profile-mapped
 * fields win over passthrough on name collision, exactly as the legacy emitter's
 * `{ ...jsonBagFields(bag), ...diffusionBody }` spread did.
 */
export function buildVendorProviderOptions<T = never>(
  providerId: string,
  paramValues: ParamValues,
  registration: WireRegistration,
  vendorBag: Record<string, T> = {}
) {
  const mapped = buildImageRequest(paramValues, registration.profile)
  // passthrough forwards vendor-bag fields the profile does NOT map (cfg,
  // imageResolution, …) — never the canonical keys the profile already
  // wire-names, or they'd ride twice (camelCase from the bag + snake from the
  // profile). Native params (n/size/seed/aspectRatio) never reach the bag.
  const extras = passthroughExtras(vendorBag, registration.profile)
  const body = registration.passthrough ? { ...jsonBag(extras), ...mapped } : mapped
  const result = new Map<string, Record<string, JSONValue | T>>()

  // The primary body rides under the registration's delivery key when it overrides
  // the provider id (Vertex: id `google-vertex`, but the SDK reads `providerOptions.vertex`).
  if (Object.keys(body).length > 0) result.set(registration.key ?? providerId, body)

  // The `openai` mirror carries the CLEAN OpenAI image body (mapped fields only),
  // never the passthrough vendor bag: `@ai-sdk/openai` rejects unknown fields,
  // while the provider's own key (e.g. aihubmix, whose custom model reads the bag)
  // gets the full body. With no passthrough (the openai family) body === mapped, so
  // this is unchanged for them.
  if (registration.dualOpenAI && Object.keys(mapped).length > 0) result.set('openai', mapped)

  // Sibling-key bodies (dmxapi → google.imageConfig), emitted only when non-empty.
  for (const extra of registration.also ?? []) {
    const extraBody = buildImageRequest(paramValues, extra.profile)

    if (Object.keys(extraBody).length > 0) result.set(extra.key, extraBody)
  }

  return Object.fromEntries(result)
}
