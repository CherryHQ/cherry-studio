import { compact, uniq } from 'lodash'

export type ApiKeyValidity =
  | {
      isValid: true
      error?: never
    }
  | {
      isValid: false
      error: string
    }

export function normalizeApiKeys(keys: string[]): string[] {
  return uniq(compact(keys.map((key) => key.trim())))
}

export function validateApiKey(
  key: string,
  existingKeys: string[],
  emptyError: string,
  duplicateError: string
): ApiKeyValidity {
  const trimmedKey = key.trim()

  if (!trimmedKey) {
    return { isValid: false, error: emptyError }
  }

  if (existingKeys.some((existingKey) => existingKey.trim() === trimmedKey)) {
    return { isValid: false, error: duplicateError }
  }

  return { isValid: true }
}

export function replaceApiKey(keys: string[], index: number, key: string): string[] | null {
  if (index < 0 || index >= keys.length) {
    return null
  }

  const nextKeys = [...keys]
  nextKeys[index] = key
  return normalizeApiKeys(nextKeys)
}

export function removeApiKey(keys: string[], index: number): string[] | null {
  if (index < 0 || index >= keys.length) {
    return null
  }

  return normalizeApiKeys(keys.filter((_, itemIndex) => itemIndex !== index))
}
