import type { JSONValue } from 'ai'

import type { WireProfile } from './wireProfile'

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
