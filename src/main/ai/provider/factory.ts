import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { AppProviderId } from '../types'
import { resolveAiSdkProviderId } from './endpoint'
import { extensions } from './extensions'

for (const extension of extensions) {
  if (!extensionRegistry.has(extension.config.name)) {
    extensionRegistry.register(extension)
  }
}

export function getAiSdkProviderId(provider: Provider): AppProviderId {
  return resolveAiSdkProviderId(provider, provider.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
}
