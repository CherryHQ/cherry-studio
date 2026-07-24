import { formatApiKeys, splitApiKeyString } from '@renderer/utils/api'

export type ConnectionModelDetectionIntent = 'detect' | 'invalidate'

export interface ConnectionModelDetectionEvent {
  intent: ConnectionModelDetectionIntent
  shouldGuideExistingModels?: boolean
}

export interface ConnectionModelDetectionSignal extends ConnectionModelDetectionEvent {
  version: number
}

export function parseEnabledApiKeyInput(value: string): string[] {
  return splitApiKeyString(formatApiKeys(value)).filter(Boolean)
}

export function classifyEnabledApiKeyChange(
  previousKeys: readonly string[],
  nextKeys: readonly string[]
): ConnectionModelDetectionIntent | null {
  const previous = new Set(previousKeys.map((key) => key.trim()).filter(Boolean))
  const next = new Set(nextKeys.map((key) => key.trim()).filter(Boolean))
  const changed = previous.size !== next.size || [...previous].some((key) => !next.has(key))

  if (!changed) {
    return null
  }

  return [...next].some((key) => !previous.has(key)) ? 'detect' : 'invalidate'
}
