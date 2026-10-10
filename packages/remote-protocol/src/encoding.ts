import { canonicalize } from 'json-canonicalize'
import * as z from 'zod'

import { unicodeText } from './values'

function validateStrings(value: z.infer<ReturnType<typeof z.json>>): void {
  if (typeof value === 'string') unicodeText.parse(value)
  else if (Array.isArray(value)) value.forEach(validateStrings)
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      unicodeText.parse(key)
      validateStrings(child)
    }
  }
}

export function encodeCanonical(value: unknown): Uint8Array {
  const json = z.json().parse(value)
  validateStrings(json)
  return new TextEncoder().encode(canonicalize(json))
}
