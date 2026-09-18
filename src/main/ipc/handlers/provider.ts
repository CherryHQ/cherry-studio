import { setProviderLogo } from '@main/services/entityLogo'
import { queryProviderBalance } from '@main/services/providerBalance'
import type { providerRequestSchemas } from '@shared/ipc/schemas/provider'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Provider imperative command handlers. Thin adapter: `provider.set_logo`
 * delegates the create→bind→compensate orchestration to `setProviderLogo`.
 */
export const providerHandlers: IpcHandlersFor<typeof providerRequestSchemas> = {
  'provider.balance.get': ({ providerId, keyId }) => queryProviderBalance(providerId, keyId),
  'provider.balance.test': ({ providerId, keyId, config }) => queryProviderBalance(providerId, keyId, config),
  'provider.set_logo': ({ providerId, image }) => setProviderLogo(providerId, image)
}
