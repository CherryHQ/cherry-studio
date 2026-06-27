import type { JSONValue } from 'ai'

import type { WireProfile, WireRegistration } from './wireProfile'

/**
 * Map a canonical `paramValues` bag to a vendor request body via the profile's
 * field rules. Drops `undefined` / `''` / `null` / `'auto'` — mirroring the old
 * `compact()` so the body is byte-identical to `buildImageProviderOptions`'
 * diffusion path. Native params (`n`/`size`/`seed`/`aspectRatio`) are NOT this
 * function's concern except where a profile re-declares one in the body (silicon
 * duplicates `seed`).
 */
export function buildImageRequest(
  paramValues: Record<string, unknown>,
  profile: WireProfile
): Record<string, JSONValue> {
  const body: Record<string, JSONValue> = {}
  for (const [key, rule] of Object.entries(profile.fields)) {
    if (!rule) continue
    const value = paramValues[key]
    if (value === undefined || value === '' || value === null || value === 'auto') continue
    body[rule.to] = rule.map ? rule.map(value, paramValues) : (value as JSONValue)
  }
  return body
}

/**
 * Forward vendor-bag fields the profile doesn't map (SiliconFlow Qwen-Image's
 * `cfg`, …). The bag may also carry non-JSON callbacks that ride the plugin chain
 * off-band (the polling `onProgress`); skip anything not JSON-serializable rather
 * than leak it into the body. Mirrors imageOptions' `jsonBagFields` so the
 * `passthrough` path is byte-identical to the legacy `diffusion` emitter.
 */
function jsonBag(bag: Record<string, unknown>): Record<string, JSONValue> {
  const out: Record<string, JSONValue> = {}
  for (const [k, v] of Object.entries(bag)) {
    if (typeof v === 'function' || typeof v === 'symbol' || v === undefined) continue
    out[k] = v as JSONValue
  }
  return out
}

/**
 * Build the AI SDK `providerOptions` map for a registered provider: its engine
 * body keyed by the provider id (and `openai` too when `dualOpenAI`). Returns
 * `{}` when the body is empty — matching `buildImageProviderOptions`' `under()`/
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
export function buildVendorProviderOptions(
  providerId: string,
  paramValues: Record<string, unknown>,
  registration: WireRegistration,
  vendorBag: Record<string, unknown> = {}
): Record<string, Record<string, JSONValue>> {
  const mapped = buildImageRequest(paramValues, registration.profile)
  const body = registration.passthrough ? { ...jsonBag(vendorBag), ...mapped } : mapped
  if (Object.keys(body).length === 0) return {}
  return registration.dualOpenAI ? { openai: body, [providerId]: body } : { [providerId]: body }
}
