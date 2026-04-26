import {
  toV1ModelForCheckApi,
  toV1ProviderShim
} from '@renderer/pages/settings/ProviderSettingsV2/utils/v1ProviderShim'
import { checkApi } from '@renderer/services/ApiService'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

interface ProviderCheckApiAdapterParams {
  provider: Provider
  models: Model[]
  selectedModel: Model
  apiKey: string
  apiHost: string
}

export async function providerCheckApiAdapter({
  provider,
  models,
  selectedModel,
  apiKey,
  apiHost
}: ProviderCheckApiAdapterParams) {
  const v1Provider = toV1ProviderShim(provider, {
    models,
    apiKey,
    apiHost
  })

  await checkApi(v1Provider, toV1ModelForCheckApi(selectedModel))
}
