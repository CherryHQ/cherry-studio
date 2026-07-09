import { popup } from '@renderer/services/popup'
import { openSettingsTab } from '@renderer/services/settingsNavigation'
import { isOllamaProvider } from '@shared/utils/provider'
import { isEmpty } from 'es-toolkit/compat'
import i18next from 'i18next'

import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

/**
 * Providers that run without an API key (local servers). Short-circuits the
 * apiKey check so canonicalGenerate's unconditional `checkProviderEnabled`
 * call doesn't trip on OVMS's local OpenVINO Model Server or a local Ollama
 * instance. An API key stays optional, not disabled — if one is configured
 * (e.g. a reverse-proxied Ollama) it's still sent, this just stops the
 * mandatory pre-flight check from blocking the common keyless case. This
 * exempts the API key requirement only — a disabled provider is still
 * disabled, see `checkProviderEnabled`.
 */
export const NO_AUTH_PROVIDER_IDS: ReadonlySet<string> = new Set(['ovms', 'ollama'])

/**
 * Matches a provider against `NO_AUTH_PROVIDER_IDS`, by id, by the preset it was
 * copied from (e.g. a duplicated Ollama entry), or — for Ollama specifically —
 * by `defaultChatEndpoint`, so an endpoint-only local Ollama provider (created
 * via the Provider editor or a deep link, with neither a matching id nor
 * `presetProviderId`) is still recognized. Reuses `isOllamaProvider`, the same
 * identity contract the model-sync side already uses for Ollama.
 */
export function isNoAuthProvider(
  provider: Pick<PaintingProviderRuntime, 'id' | 'presetProviderId' | 'defaultChatEndpoint'>
): boolean {
  return (
    NO_AUTH_PROVIDER_IDS.has(provider.id) ||
    (!!provider.presetProviderId && NO_AUTH_PROVIDER_IDS.has(provider.presetProviderId)) ||
    isOllamaProvider(provider)
  )
}

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

  if (isNoAuthProvider(provider)) {
    return ''
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
