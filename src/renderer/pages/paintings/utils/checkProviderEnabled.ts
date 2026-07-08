import { popup } from '@renderer/services/popup'
import { openSettingsTab } from '@renderer/services/settingsNavigation'
import { isEmpty } from 'es-toolkit/compat'
import i18next from 'i18next'

import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

function navigateToProviderSettings(providerId: string) {
  openSettingsTab(`/settings/provider?id=${encodeURIComponent(providerId)}`)
}

export async function checkProviderEnabled(provider: PaintingProviderRuntime): Promise<string> {
  // Credential-free local servers (registry `authOptional`, e.g. OVMS) short-circuit
  // the apiKey check so canonicalGenerate's unconditional `checkProviderEnabled` call
  // doesn't trip on them. The vendor adapter knows not to attach an Authorization header.
  if (provider.authOptional) {
    return ''
  }

  if (!provider.isEnabled) {
    if (
      await popup.warning({
        content: i18next.t('error.provider_disabled'),
        centered: true,
        closable: true,
        okText: i18next.t('common.go_to_settings')
      })
    ) {
      navigateToProviderSettings(provider.id)
    }
    throw 'Provider disabled'
  }

  const apiKey = await provider.getApiKey()
  if (!isEmpty(apiKey)) {
    return apiKey
  }

  if (
    await popup.warning({
      content: i18next.t('error.no_api_key'),
      centered: true,
      closable: true,
      okText: i18next.t('common.go_to_settings')
    })
  ) {
    navigateToProviderSettings(provider.id)
  }
  throw 'No API key'
}
