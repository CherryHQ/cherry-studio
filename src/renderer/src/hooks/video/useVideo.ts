import { useProviderVideos } from './useProviderVideos'

export const useVideo = (providerId: string, id: string) => {
  const { videos } = useProviderVideos(providerId)
  const video = videos.find((v) => v.id === id)
  return video
}
