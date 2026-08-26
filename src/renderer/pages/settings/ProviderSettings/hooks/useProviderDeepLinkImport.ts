import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProviderActions, useProviders } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import type { ProviderType } from '@renderer/types/provider'
import { validateApiHost } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import UrlSchemaInfoPopup from '../UrlSchemaInfoPopup'
import { syncProviderModelsForProvider } from './useProviderModelSync'

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
  autoSyncModels?: boolean
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
  const { createModels } = useModelMutations()
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
        if (updatedProvider.apiHost && !validateApiHost(updatedProvider.apiHost)) {
          logger.warn('Rejected deep-link apiHost with invalid scheme', { providerId })
          toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
          void navigate({ to: '/settings/provider' })
          return
        }
        const endpointConfigs = updatedProvider.apiHost
          ? {
              [defaultChatEndpoint]: {
                baseUrl: updatedProvider.apiHost
              }
            }
          : undefined

        const persistedProvider = isNew
          ? await createProvider({
              providerId,
              name: updatedProvider.name || providerData.id,
              defaultChatEndpoint,
              endpointConfigs
            })
          : await updateProviderById(providerId, {
              name: updatedProvider.name,
              defaultChatEndpoint,
              endpointConfigs
            })

        if (updatedProvider.apiKey.trim()) {
          await addApiKeyTrigger({
            params: { providerId },
            body: { key: updatedProvider.apiKey.trim() }
          })
        }

        // New providers only: an existing key would otherwise be sent to the imported base URL.
        if (popupResult.autoSyncModels && isNew) {
          try {
            const models = await syncProviderModelsForProvider({
              providerId,
              endpointProvider: persistedProvider,
              createModels
            })
            if (models.length > 0) {
              await updateProviderById(providerId, { isEnabled: true })
            }
          } catch (error) {
            logger.error('Failed to sync models after provider deep-link import', { providerId, error })
            toast.warning(t('settings.models.manage.sync_pull_failed'))
          }
        }

        onSelectProvider(providerId)
        void navigate({ to: '/settings/provider', search: { id: providerId } })
        toast.success(t('settings.models.provider_key_added', { provider: displayName }))
      } catch (error) {
        logger.error('Failed to import provider deep link data', error as Error)
        toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
      }
    }

    try {
      const parsed = JSON.parse(searchAddProviderData) as ImportedProviderSearchData

      if (!parsed.id || !parsed.apiKey || !parsed.baseUrl) {
        toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
        return
      }

      void importProvider(parsed)
    } catch (error) {
      logger.error('Failed to parse provider deep link import data', error as Error)
      toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
      void navigate({ to: '/settings/provider' })
    }
  }, [
    addApiKeyTrigger,
    createModels,
    createProvider,
    navigate,
    onSelectProvider,
    searchAddProviderData,
    t,
    updateProviderById
  ])
}
