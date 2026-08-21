import { miniAppService } from '@data/services/MiniAppService'
import { providerService } from '@data/services/ProviderService'
import type { LogoBindInput } from '@data/services/utils/logoRef'
import type { SetLogoIntent } from '@shared/ipc/schemas/logo'

import { withUploadedIconEntry } from './uploadedIcon'

type MaybePromise<T> = T | Promise<T>

async function bindLogoIntent(
  intent: SetLogoIntent,
  bind: (input: LogoBindInput) => MaybePromise<void>
): Promise<void> {
  if (intent.kind === 'key') return bind({ kind: 'key', key: intent.key })
  if (intent.kind === 'default') return bind({ kind: 'default' })
  await withUploadedIconEntry(intent.data, (fileId) => bind({ kind: 'file', fileId }))
}

export function setProviderLogo(providerId: string, intent: SetLogoIntent): Promise<void> {
  return bindLogoIntent(intent, (logo) => {
    providerService.update(providerId, { logo })
  })
}

export function setMiniAppLogo(appId: string, intent: SetLogoIntent): Promise<void> {
  return bindLogoIntent(intent, (logo) => {
    miniAppService.update(appId, { logo })
  })
}
