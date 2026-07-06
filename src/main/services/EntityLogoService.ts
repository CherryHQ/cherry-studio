import { miniAppService } from '@data/services/MiniAppService'
import { providerService } from '@data/services/ProviderService'
import { bindLogoImage } from '@main/services/file/utils/entityImageBinding'
import type { LogoImageIntent } from '@shared/ipc/schemas/entityImage'

/**
 * Owns the provider / mini-app set-logo orchestration: from business intent +
 * raw bytes → create the `file_entry` → bind it via the DataApi service's
 * `reconcileLogoSlotTx` → compensate (permanentDelete) on failure. The IPC
 * handlers stay thin adapters and the DataApi services stay pure-DB; the only
 * `fileId` that reaches a slot is one this service just minted.
 *
 * A plain singleton (no long-lived resources or persistent side effects), per
 * the non-lifecycle-service rule. `bindLogoImage` (the file create/compensate
 * primitive) is shared with the avatar flow via `entityImageBinding`.
 */
class EntityLogoService {
  setProviderLogo(providerId: string, image: LogoImageIntent): Promise<void> {
    return bindLogoImage(image, (logo) => {
      providerService.update(providerId, { logo })
    })
  }

  setMiniAppLogo(appId: string, image: LogoImageIntent): Promise<void> {
    return bindLogoImage(image, (logo) => {
      miniAppService.update(appId, { logo })
    })
  }
}

export const entityLogoService = new EntityLogoService()
