import { supportsImageRequestTimeout } from '@renderer/utils/imageGenerationTimeout'

export function resolveImageRequestTimeoutMs(
  providerId: string | undefined,
  draftTimeoutMs: number | undefined,
  providerTimeoutMs: number | undefined
): number | undefined {
  return draftTimeoutMs ?? (supportsImageRequestTimeout(providerId) ? providerTimeoutMs : undefined)
}
