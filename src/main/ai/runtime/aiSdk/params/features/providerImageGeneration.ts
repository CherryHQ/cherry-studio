import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { isNativeImageGenerationAvailable } from '@shared/ai/nativeImageGeneration'

import type { RequestFeature } from '../feature'

export const providerImageGenerationFeature: RequestFeature = {
  name: 'provider-image-generation',
  applies: (scope) =>
    scope.assistant?.settings.enableNativeImageGeneration === true &&
    scope.aiSdkProviderId === 'xai-responses' &&
    isNativeImageGenerationAvailable(scope.model, scope.provider),
  contributeModelAdapters: () => [providerToolPlugin('imageGeneration')]
}
