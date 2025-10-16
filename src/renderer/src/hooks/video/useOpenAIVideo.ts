import { retrieveVideo } from '@renderer/services/ApiService'
import type { SWRConfiguration } from 'swr'
import useSWR, { useSWRConfig } from 'swr'

import { useProvider } from '../useProvider'
import { useVideo } from './useVideo'

export const useOpenAIVideo = (providerId: string, id: string) => {
  const { provider } = useProvider(providerId)
  const fetcher = async () => {
    switch (provider.type) {
      case 'openai-response':
        return retrieveVideo({
          type: 'openai',
          videoId: id,
          provider
        })

      default:
        throw new Error(`Unsupported provider type: ${provider.type}`)
    }
  }
  const video = useVideo(providerId, id)
  let options: SWRConfiguration = {}
  switch (video?.status) {
    case 'queued':
    case 'in_progress':
      options = {
        refreshInterval: 3000
      }
      break
    default:
      options = {
        revalidateOnFocus: false,
        revalidateOnMount: true
      }
  }
  const { data, isLoading, error } = useSWR(`video/openai/${id}`, fetcher, options)
  const { mutate } = useSWRConfig()
  const revalidate = () => mutate(`video/openai/${id}`)

  return {
    video: data,
    isLoading,
    error,
    revalidate
  }
}
