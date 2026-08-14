import { useQuery } from '@data/hooks/useDataApi'
import type { ImageGenerationSupport } from '@shared/data/types/model'

/**
 * Read the registry's painting-page metadata block for a (provider, model)
 * pair. Drives the generic painting form when a provider opts into
 * `useRegistryForm`. Returns `undefined` while loading, on a miss, or when
 * `providerId` / `modelId` is unavailable — callers treat that as "no derived
 * fields" and fall back to the provider's hand-rolled `fields.byTab`.
 *
 * The hook is always invoked at the call site (rules-of-hooks); `enabled`
 * gates the actual fetch so it's safe to pass undefined ids.
 */
export function useImageGenerationSupport(
  providerId: string | undefined,
  modelId: string | undefined
): ImageGenerationSupport | undefined {
  const { data } = useQuery('/providers/:providerId/models/:modelId*/image-generation-support', {
    params: { providerId: providerId ?? '__none__', modelId: modelId ?? '__none__' },
    enabled: Boolean(providerId && modelId)
  })
  return data ?? undefined
}
