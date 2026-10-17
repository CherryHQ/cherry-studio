import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { ProviderTypeSchema } from '@renderer/types/provider'
import { validateApiHost } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import UrlSchemaInfoPopup from '../UrlSchemaInfoPopup'
import { awaitEndpointConfigWrites, withEndpointConfigWriteLock } from './providerSetting/useProviderEndpointActions'

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

const ImportedProviderSearchDataSchema = z.object({
  id: z.string().min(1),
  apiKey: z.string().min(1),
  baseUrl: z.string().min(1),
  type: ProviderTypeSchema.optional(),
  name: z.string().optional()
})

type ImportedProviderSearchData = z.infer<typeof ImportedProviderSearchDataSchema>

type ImportPopupResult = Awaited<ReturnType<typeof UrlSchemaInfoPopup.show>>

type ImportSession = {
  payload: string
  parsed: ImportedProviderSearchData
  popupResult?: ImportPopupResult
}

/** Consumes one provider deep-link import payload from the URL into create/update + add-api-key calls. */
export function useProviderDeepLinkImport(
  searchAddProviderData: string | undefined,
  onSelectProvider: (providerId: string) => void
) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { createProvider, providers } = useProviders()
  const providersRef = useRef(providers)
  const { updateProviderById } = useProviderActions()
  const importConsumedRef = useRef<string | null>(null)
  const importSessionRef = useRef<ImportSession | null>(null)
  const importRunningRef = useRef(false)
  const { trigger: addApiKeyTrigger } = useMutation('POST', '/providers/:providerId/api-keys', {
    refresh: ({ args }) => [
      '/providers',
      `/providers/${args!.params.providerId}`,
      `/providers/${args!.params.providerId}/*`
    ]
  })

  const runImportSessionRef = useRef<(session: ImportSession) => void>(() => {})

  const runImportSession = useCallback(
    (session: ImportSession) => {
      importRunningRef.current = true

      const importProvider = async (activeSession: ImportSession) => {
        try {
          if (!activeSession.popupResult) {
            activeSession.popupResult = await UrlSchemaInfoPopup.show(activeSession.parsed)
          }
          const { updatedProvider, isNew, nameOnly, displayName } = activeSession.popupResult

          if (!updatedProvider) {
            void navigate({ to: '/settings/provider' })
            importConsumedRef.current = activeSession.payload
            if (importSessionRef.current?.payload === activeSession.payload) {
              importSessionRef.current = null
            }
            return
          }

          const providerId = updatedProvider.id
          const defaultChatEndpoint = resolveDefaultEndpoint(updatedProvider.type)
          if (updatedProvider.apiHost && !validateApiHost(updatedProvider.apiHost)) {
            logger.warn('Rejected deep-link apiHost with invalid scheme', { providerId })
            toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
            void navigate({ to: '/settings/provider' })
            importConsumedRef.current = activeSession.payload
            if (importSessionRef.current?.payload === activeSession.payload) {
              importSessionRef.current = null
            }
            return
          }

          const existingProvider = providersRef.current.find((entry) => entry.id === providerId)
          if (!isNew && !existingProvider) {
            return
          }

          if (isNew) {
            const endpointConfigs = updatedProvider.apiHost
              ? {
                  [defaultChatEndpoint]: {
                    baseUrl: updatedProvider.apiHost
                  }
                }
              : undefined

            await createProvider({
              providerId,
              name: updatedProvider.name || activeSession.parsed.id,
              defaultChatEndpoint,
              endpointConfigs
            })
          } else {
            let persisted = false
            await awaitEndpointConfigWrites(providerId)
            await withEndpointConfigWriteLock(providerId, async () => {
              const liveProvider = providersRef.current.find((entry) => entry.id === providerId)
              if (!liveProvider) {
                return
              }

              const endpointConfigs = buildDeepLinkEndpointConfigs(
                liveProvider,
                defaultChatEndpoint,
                updatedProvider.apiHost
              )

              await updateProviderById(
                providerId,
                nameOnly
                  ? { name: updatedProvider.name }
                  : { name: updatedProvider.name, defaultChatEndpoint, endpointConfigs }
              )
              persisted = true
            })
            if (!persisted) {
              return
            }
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
          importConsumedRef.current = activeSession.payload
          if (importSessionRef.current?.payload === activeSession.payload) {
            importSessionRef.current = null
          }
        } catch (error) {
          logger.error('Failed to import provider deep link data', error as Error)
          toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
          void navigate({ to: '/settings/provider' })
          importConsumedRef.current = activeSession.payload
          if (importSessionRef.current?.payload === activeSession.payload) {
            importSessionRef.current = null
          }
        }
      }

      void importProvider(session).finally(() => {
        importRunningRef.current = false
        const pending = importSessionRef.current
        if (pending && pending.payload !== session.payload) {
          runImportSessionRef.current(pending)
        }
      })
    },
    [addApiKeyTrigger, createProvider, navigate, onSelectProvider, t, updateProviderById]
  )

  runImportSessionRef.current = runImportSession

  useEffect(() => {
    providersRef.current = providers
  }, [providers])

  useEffect(() => {
    if (!searchAddProviderData) {
      importConsumedRef.current = null
      importSessionRef.current = null
      return
    }

    if (importConsumedRef.current === searchAddProviderData) {
      return
    }

    let parsed: ImportedProviderSearchData
    try {
      const result = ImportedProviderSearchDataSchema.safeParse(JSON.parse(searchAddProviderData))

      if (!result.success) {
        toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
        void navigate({ to: '/settings/provider' })
        importConsumedRef.current = searchAddProviderData
        return
      }
      parsed = result.data
    } catch (error) {
      logger.error('Failed to parse provider deep link import data', error as Error)
      toast.error(t('settings.models.provider_key_add_failed_by_invalid_data'))
      void navigate({ to: '/settings/provider' })
      return
    }

    if (!importSessionRef.current || importSessionRef.current.payload !== searchAddProviderData) {
      importSessionRef.current = { payload: searchAddProviderData, parsed }
    }

    if (importRunningRef.current) {
      return
    }

    // Reserve before the confirmation popup so a providers refresh cannot restart this import.
    importRunningRef.current = true
    runImportSession(importSessionRef.current)
  }, [createProvider, navigate, onSelectProvider, providers, runImportSession, searchAddProviderData, t])
}

function buildDeepLinkEndpointConfigs(
  liveProvider: Provider,
  defaultChatEndpoint: EndpointType,
  apiHost: string | undefined
): Provider['endpointConfigs'] {
  if (!apiHost) {
    return liveProvider.endpointConfigs
  }

  return {
    ...liveProvider.endpointConfigs,
    [defaultChatEndpoint]: {
      ...liveProvider.endpointConfigs?.[defaultChatEndpoint],
      baseUrl: apiHost
    }
  }
}
