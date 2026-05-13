import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProviders'
import type { ProviderType } from '@renderer/types'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import UrlSchemaInfoPopup from '../UrlSchemaInfoPopup'

const logger = loggerService.withContext('useProviderDeepLinkImport')

function resolveDefaultEndpoint(type?: string): EndpointType {
  switch (type) {
    case 'anthropic':
    case 'vertex-anthropic':
      return ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    case 'openai-response':
      return ENDPOINT_TYPE.OPENAI_RESPONSES
    case 'gemini':
    case 'vertexai':
      return ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    case 'ollama':
      return ENDPOINT_TYPE.OLLAMA_CHAT
    default:
      return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  }
}

interface ImportedProviderSearchData {
  id: string
  apiKey: string
  baseUrl: string
  type?: ProviderType
  name?: string
}

/** Consumes one provider deep-link import payload from the URL into create/update + add-api-key calls. */
export function useProviderDeepLinkImport(
  searchAddProviderData: string | undefined,
  onSelectProvider: (providerId: string) => void
) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { createProvider } = useProviders()
  const { updateProviderById } = useProviderActions()
  const { trigger: addApiKeyTrigger } = useMutation('POST', '/providers/:providerId/api-keys', {
    refresh: ({ args }) => [
      '/providers',
      `/providers/${args!.params.providerId}`,
      `/providers/${args!.params.providerId}/*`
    ]
  })

  useEffect(() => {
    if (!searchAddProviderData) {
      return
    }

    const importProvider = async (providerData: ImportedProviderSearchData) => {
      try {
        const popupResult = await UrlSchemaInfoPopup.show(providerData)
        const { updatedProvider, isNew, displayName } = popupResult

        if (!updatedProvider) {
          void navigate({ to: '/settings/provider' })
          return
        }

        const providerId = updatedProvider.id
        const defaultChatEndpoint = resolveDefaultEndpoint(updatedProvider.type)
        const endpointConfigs = updatedProvider.apiHost
          ? {
              [defaultChatEndpoint]: {
                baseUrl: updatedProvider.apiHost
              }
            }
          : undefined

        if (isNew) {
          await createProvider({
            providerId,
            name: updatedProvider.name || providerData.id,
            defaultChatEndpoint,
            endpointConfigs
          })
        } else {
          await updateProviderById(providerId, {
            name: updatedProvider.name,
            defaultChatEndpoint,
            endpointConfigs
          })
        }

        if (updatedProvider.apiKey.trim()) {
          await addApiKeyTrigger({
            params: { providerId },
            body: { key: updatedProvider.apiKey.trim() }
          })
        }

        onSelectProvider(providerId)
        void navigate({ to: '/settings/provider', search: { id: providerId } })
        window.toast.success(t('settings.models.provider_key_added', { provider: displayName }))
      } catch (error) {
        logger.error('Failed to import provider deep link data', error as Error)
        window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
      }
    }

    try {
      const parsed = JSON.parse(searchAddProviderData) as ImportedProviderSearchData

      if (!parsed.id || !parsed.apiKey || !parsed.baseUrl) {
        window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
        return
      }

      void importProvider(parsed)
    } catch (error) {
      logger.error('Failed to parse provider deep link import data', error as Error)
      window.toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
      void navigate({ to: '/settings/provider' })
    }
  }, [addApiKeyTrigger, createProvider, navigate, onSelectProvider, searchAddProviderData, t, updateProviderById])
}
