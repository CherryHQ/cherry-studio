import { application } from '@application'
import { setProviderLogo } from '@main/services/entityLogo'
import type { providerRequestSchemas } from '@shared/ipc/schemas/provider'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Provider imperative command handlers. Thin adapter: `provider.set_logo`
 * delegates the create→bind→compensate orchestration to `setProviderLogo`.
 * `provider.get_subscription_quota` delegates to `SubscriptionQuotaService`.
 */
export const providerHandlers: IpcHandlersFor<typeof providerRequestSchemas> = {
  'provider.set_logo': ({ providerId, image }) => setProviderLogo(providerId, image),
  'provider.get_subscription_quota': (input) => application.get('SubscriptionQuotaService').getSubscriptionQuota(input)
}
