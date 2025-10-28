import { usePreference } from '@data/hooks/usePreference'

import { useOcrProvider } from './useOcrProvider'

export const useOcrImageProvider = () => {
  const [imageProviderId, setImageProviderId] = usePreference('ocr.settings.image_provider_id')
  const { provider: imageProvider, mutating, loading, error, updateConfig } = useOcrProvider(imageProviderId)
  return { imageProvider, loading, mutating, error, updateConfig, imageProviderId, setImageProviderId }
}
