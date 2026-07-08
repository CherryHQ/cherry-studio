import { popup } from '@renderer/services/popup'
import { openSettingsTab } from '@renderer/services/settingsNavigation'
import { isEmpty } from 'es-toolkit/compat'
import i18next from 'i18next'

import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

/**
 * Providers that run without an API key (local servers). Short-circuits the
 * apiKey check so canonicalGenerate's unconditional `checkProviderEnabled`
 * call doesn't trip on OVMS's local OpenVINO Model Server or a local Ollama
 * instance. An API key stays optional, not disabled — if one is configured
 * (e.g. a reverse-proxied Ollama) it's still sent, this just stops the
 * mandatory pre-flight check from blocking the common keyless case.
 */
export const NO_AUTH_PROVIDER_IDS: ReadonlySet<string> = new Set(['ovms', 'ollama'])

function navigateToProviderSettings(providerId: string) {
  openSettingsTab(`/settings/provider?id=${encodeURIComponent(providerId)}`)
}

export async function checkProviderEnabled(provider: PaintingProviderRuntime): Promise<string> {
  if (NO_AUTH_PROVIDER_IDS.has(provider.id)) {
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
