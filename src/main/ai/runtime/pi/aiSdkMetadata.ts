import type { ProviderMetadata } from 'ai'

const SIGNATURE_PREFIX = 'aisdk:'

/**
 * Encodes AI SDK provider metadata (reasoning signatures, item ids) into a Pi signature slot
 * (`thinkingSignature`, `textSignature`, `thoughtSignature`) so it replays to the same model.
 * Hosts use it when they rebuild Pi history from stored AI SDK parts.
 */
export function encodeProviderMetadata(metadata: ProviderMetadata | undefined): string | undefined {
  return metadata && Object.keys(metadata).length > 0 ? SIGNATURE_PREFIX + JSON.stringify(metadata) : undefined
}

export function decodeProviderMetadata(signature: string | undefined): ProviderMetadata | undefined {
  if (!signature?.startsWith(SIGNATURE_PREFIX)) return undefined
  try {
    return JSON.parse(signature.slice(SIGNATURE_PREFIX.length)) as ProviderMetadata
  } catch {
    return undefined
  }
}
