import { miniAppService } from '@data/services/MiniAppService'
import { providerService } from '@data/services/ProviderService'
import { bindLogoImage } from '@main/services/entityImageBinding'
import type { LogoImageIntent } from '@shared/ipc/schemas/entityImage'

/**
 * Provider / mini-app set-logo orchestration: from a set-logo intent + raw bytes
 * → create the `file_entry` → bind it via the DataApi service's
 * `reconcileLogoSlotTx` → compensate (`permanentDelete`) on failure. Plain
 * stateless functions with outward side effects (Naming §5.2), matching the
 * sibling `entityImageBinding`; the IPC handlers stay thin adapters and the
 * DataApi services stay pure-DB. The only `fileId` a slot ever sees is one
 * `bindLogoImage` just minted.
 *
 * The avatar (`profile.set_avatar`) is the same operation *class* but a distinct
 * owner — no logo ref row; its bytes bind straight to the `app.user.avatar`
 * preference — so it composes the shared `withCreatedImageEntry` primitive
 * directly rather than through the logo-specific `bindLogoImage` intent handler.
 */
export function setProviderLogo(providerId: string, image: LogoImageIntent): Promise<void> {
  return bindLogoImage(image, (logo) => {
    providerService.update(providerId, { logo })
  })
}

export function setMiniAppLogo(appId: string, image: LogoImageIntent): Promise<void> {
  return bindLogoImage(image, (logo) => {
    miniAppService.update(appId, { logo })
  })
}
