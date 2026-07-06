import { entityLogoService } from '@main/services/EntityLogoService'
import type { providerRequestSchemas } from '@shared/ipc/schemas/provider'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Provider imperative command handlers. Thin adapter: `provider.set_logo`
 * delegates the create→bind→compensate orchestration to `EntityLogoService`.
 */
export const providerHandlers: IpcHandlersFor<typeof providerRequestSchemas> = {
  'provider.set_logo': ({ providerId, image }) => entityLogoService.setProviderLogo(providerId, image)
}
