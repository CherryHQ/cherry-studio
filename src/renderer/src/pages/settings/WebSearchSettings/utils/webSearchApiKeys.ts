export type ApiKeyValidity =
  | {
      isValid: true
      error?: never
    }
  | {
      isValid: false
      error: string
    }

export function normalizeWebSearchApiKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)))
}

export function validateWebSearchApiKey(
  key: string,
  existingKeys: string[],
  emptyError: string,
  duplicateError: string
): ApiKeyValidity {
  const trimmedKey = key.trim()

  if (!trimmedKey) {
    return { isValid: false, error: emptyError }
  }

  if (existingKeys.includes(trimmedKey)) {
    return { isValid: false, error: duplicateError }
  }

  return { isValid: true }
}

export function replaceWebSearchApiKey(keys: string[], index: number, key: string): string[] | null {
  if (index < 0 || index >= keys.length) {
    return null
  }

  const nextKeys = [...keys]
  nextKeys[index] = key
  return normalizeWebSearchApiKeys(nextKeys)
}

export function removeWebSearchApiKey(keys: string[], index: number): string[] | null {
  if (index < 0 || index >= keys.length) {
    return null
  }

  return normalizeWebSearchApiKeys(keys.filter((_, itemIndex) => itemIndex !== index))
}
