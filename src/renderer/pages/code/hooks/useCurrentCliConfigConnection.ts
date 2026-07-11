import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@renderer/services/LoggerService'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CLI_OWN_LOGIN_PROVIDER_ID, type CodeCli } from '@shared/types/codeCli'
import { useEffect, useState } from 'react'

import {
  type CliConfigConnection,
  cliConfigConnectionMatchesProvider,
  extractConnectionFromCliConfigDraft,
  readCliConfigFiles,
  resolveCliConfigApplyContext
} from '../cliConfig'

const logger = loggerService.withContext('useCurrentCliConfigConnection')

async function readProviderApiKeys(providerId: string): Promise<ApiKeyEntry[]> {
  const result = (await dataApiService.get(`/providers/${providerId}/api-keys`)) as { keys?: ApiKeyEntry[] } | undefined
  return result?.keys ?? []
}

export function useCurrentCliConfigConnection({
  enabledProvider,
  selectedCliTool,
  currentProviderConfig
}: {
  enabledProvider?: Provider
  selectedCliTool: CodeCli
  currentProviderConfig?: CliProviderConfig | null
}): [CliConfigConnection | null, (connection: CliConfigConnection | null) => void] {
  const [currentCliConfigConnection, setCurrentCliConfigConnection] = useState<CliConfigConnection | null>(null)

  useEffect(() => {
    let cancelled = false
    // The virtual own-login entry has no app-side credential to reconcile against a CLI config file.
    if (!enabledProvider || enabledProvider.id === CLI_OWN_LOGIN_PROVIDER_ID) {
      setCurrentCliConfigConnection(null)
      return
    }

    void (async () => {
      const files = await readCliConfigFiles(selectedCliTool)
      const connection = extractConnectionFromCliConfigDraft(selectedCliTool, files)
      if (!connection) {
        if (!cancelled) setCurrentCliConfigConnection(null)
        return
      }
      const apiKeys = await readProviderApiKeys(enabledProvider.id)
      const currentCliConfigContext = resolveCliConfigApplyContext(
        selectedCliTool,
        enabledProvider.id,
        currentProviderConfig ?? undefined
      )
      const expectedModel = currentCliConfigContext?.writePrimaryModel ? currentCliConfigContext.rawModelId : undefined
      if (cancelled) return
      setCurrentCliConfigConnection(
        cliConfigConnectionMatchesProvider(selectedCliTool, connection, enabledProvider, apiKeys, expectedModel)
          ? null
          : connection
      )
    })().catch((error) => {
      logger.error('Failed to read current CLI config connection:', error as Error)
      if (!cancelled) setCurrentCliConfigConnection(null)
    })

    return () => {
      cancelled = true
    }
  }, [enabledProvider, selectedCliTool, currentProviderConfig])

  return [currentCliConfigConnection, setCurrentCliConfigConnection]
}
