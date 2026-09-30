import { normalizeModelId } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { getRawModelId } from '@shared/utils/model'

/** Initial native-image support is limited to the documented Grok 4.7 Responses model. */
export function isNativeImageGenerationAvailable(model: Model | undefined, provider: Provider | undefined): boolean {
  if (!model || !provider) return false
  const endpoint = model.endpointTypes?.[0] ?? provider.defaultChatEndpoint
  return (
    endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES &&
    provider.endpointConfigs?.[endpoint]?.adapterFamily === 'xai-responses' &&
    normalizeModelId(getRawModelId(model)) === 'grok-4-7'
  )
}
