import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import i18next from 'i18next'

import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

function navigateToProviderSettings(providerId: string) {
  openSettingsTab(`/settings/provider?id=${encodeURIComponent(providerId)}`)
}

export async function checkProviderEnabled(provider: PaintingProviderRuntime): Promise<string> {
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

  // Keyless-permissive: return whatever key exists (possibly empty) and let the
  // request fail naturally if the provider requires one — consistent with chat/agent.
  return provider.getApiKey()
}
