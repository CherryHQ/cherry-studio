import { supportsImageRequestTimeout } from '@renderer/utils/imageGenerationTimeout'

export function resolveImageRequestTimeoutMs(
  provider: { id?: string; presetProviderId?: string | null },
  draftTimeoutMs: number | undefined,
  providerTimeoutMs: number | undefined
): number | undefined {
  return draftTimeoutMs ?? (supportsImageRequestTimeout(provider) ? providerTimeoutMs : undefined)
}
