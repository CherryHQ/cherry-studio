import { miniAppService } from '@data/services/MiniAppService'
import { providerService } from '@data/services/ProviderService'
import { bindLogoImage } from '@main/ipc/handlers/utils/entityImageBinding'
import type { entityImageRequestSchemas } from '@shared/ipc/schemas/entityImage'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Provider / mini-app set-logo commands. The renderer sends business intent +
 * raw bytes; the handler owns the file lifecycle (create the `file_entry` →
 * bind it via the DataApi service's `reconcileLogoSlotTx` → compensate on
 * failure) so the services stay pure-DB and no orphan `file_entry` outlives a
 * failed bind.
 */
export const entityImageHandlers: IpcHandlersFor<typeof entityImageRequestSchemas> = {
  'provider.set_logo': ({ providerId, image }) =>
    bindLogoImage(image, async (logo) => {
      await providerService.update(providerId, { logo })
    }),
  'mini_app.set_logo': ({ appId, image }) =>
    bindLogoImage(image, async (logo) => {
      await miniAppService.update(appId, { logo })
    })
}
