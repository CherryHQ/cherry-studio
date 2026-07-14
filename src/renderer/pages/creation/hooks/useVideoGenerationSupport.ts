import { useQuery } from '@data/hooks/useDataApi'
import type { VideoGenerationSupport } from '@shared/data/types/model'

/**
 * Video counterpart of `useImageGenerationSupport`: reads the registry's
 * `videoGeneration` metadata block for a (provider, model) pair from the
 * `video-generation-support` DataApi route. Drives the video form's mode tabs,
 * media-input pickers, and scalar fields. Returns `undefined` while loading, on
 * a miss, or when an id is unavailable — the page treats that as "no derived
 * fields".
 */
export function useVideoGenerationSupport(
  providerId: string | undefined,
  modelId: string | undefined
): VideoGenerationSupport | undefined {
  const { data } = useQuery('/providers/:providerId/models/:modelId*/video-generation-support', {
    params: { providerId: providerId ?? '__none__', modelId: modelId ?? '__none__' },
    enabled: Boolean(providerId && modelId)
  })
  return data ?? undefined
}
