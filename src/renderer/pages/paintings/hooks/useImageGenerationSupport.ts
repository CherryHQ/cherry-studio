import useSWR from 'swr'

import { useDataChange } from '@data/hooks/useDataChange'

import { fetchImageGenerationSupport } from '../model/imageGenerationSupport'

export function useImageGenerationSupport(providerId: string | undefined, modelId: string | undefined) {
  const { data, mutate } = useSWR(
    providerId && modelId ? ['ai.image.support.get', providerId, modelId] : null,
    ([, providerId, modelId]) => fetchImageGenerationSupport(providerId, modelId),
    { shouldRetryOnError: false }
  )
  useDataChange(
    ['/providers/:providerId/models/:modelId*/image-generation-support', '/providers', '/models'],
    () => void mutate()
  )
  return data
}
