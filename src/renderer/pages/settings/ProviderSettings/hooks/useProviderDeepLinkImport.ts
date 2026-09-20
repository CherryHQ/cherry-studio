import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import type { ProviderType } from '@renderer/types/provider'
import { validateApiHost } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import UrlSchemaInfoPopup from '../UrlSchemaInfoPopup'
import {
  clearLastWrittenEndpointConfigs,
  getLastWrittenEndpointConfigs,
  serializeEndpointConfigsWrite,
  setLastWrittenEndpointConfigs
} from './providerSetting/endpointConfigsWriteCoordinator'

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
  const { createProvider, providers, refetch: refetchProviders } = useProviders()
  const { updateProviderById } = useProviderActions()
  // Cached list mirror (kept out of the import effect's deps so a list
  // refresh can't re-trigger the one-shot import below).
  const providersRef = useRef(providers)
  useEffect(() => {
    providersRef.current = providers
  }, [providers])
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

        if (isNew) {
          // A deleted provider recreated under the same ID must not inherit
          // its coordinator snapshot.
          clearLastWrittenEndpointConfigs(providerId)
          await createProvider({
            providerId,
            name: updatedProvider.name || providerData.id,
            defaultChatEndpoint,
            endpointConfigs
          })
        } else if (!updatedProvider.apiHost) {
          await updateProviderById(providerId, {
            name: updatedProvider.name,
            defaultChatEndpoint,
            endpointConfigs
          })
        } else {
          const apiHost = updatedProvider.apiHost
          // The endpointConfigs PATCH replaces the object wholesale: merge the
          // imported host onto the latest committed snapshot so a persisted
          // reasoningFormat (or another endpoint) the link doesn't mention
          // survives the import. Serialized with the settings writers so
          // overlapping saves can't clobber each other.
          await serializeEndpointConfigsWrite(providerId, async () => {
            let baseConfigs = providersRef.current.find((p) => p.id === providerId)?.endpointConfigs
            try {
              const fresh = (await refetchProviders()) as Provider[] | undefined
              // The coordinated snapshot is newer than a stale truthy refetch
              // that hasn't observed the last committed write yet.
              baseConfigs =
                getLastWrittenEndpointConfigs(providerId) ??
                fresh?.find((p) => p.id === providerId)?.endpointConfigs ??
                baseConfigs
            } catch {
              baseConfigs = getLastWrittenEndpointConfigs(providerId) ?? baseConfigs
            }
            const nextEndpointConfigs = {
              ...baseConfigs,
              [defaultChatEndpoint]: { ...baseConfigs?.[defaultChatEndpoint], baseUrl: apiHost }
            }
            await updateProviderById(providerId, {
              name: updatedProvider.name,
              defaultChatEndpoint,
              endpointConfigs: nextEndpointConfigs
            })
            setLastWrittenEndpointConfigs(providerId, nextEndpointConfigs)
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
    createProvider,
    navigate,
    onSelectProvider,
    refetchProviders,
    searchAddProviderData,
    t,
    updateProviderById
  ])
}
