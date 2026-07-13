import { dataApiService } from '@data/DataApiService'
import { useModels } from '@renderer/hooks/useModel'
import { loggerService } from '@renderer/services/LoggerService'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { CLI_OWN_LOGIN_PROVIDER_ID, type CodeCli, isApiGatewayProviderId } from '@shared/types/codeCli'
import { useEffect, useMemo, useState } from 'react'

import {
  type CliConfigConnection,
  cliConfigConnectionMatchesProvider,
  extractConnectionFromCliConfigDraft,
  gatewayExpectedModel,
  readCliConfigFiles,
  resolveCliConfigApplyContext
} from '../cliConfig'
import type { ApiGatewayProviderBundle } from './useApiGatewayProvider'

const logger = loggerService.withContext('useCurrentCliConfigConnection')

async function readProviderApiKeys(providerId: string): Promise<ApiKeyEntry[]> {
  const result = (await dataApiService.get(`/providers/${providerId}/api-keys`)) as { keys?: ApiKeyEntry[] } | undefined
  return result?.keys ?? []
}

export function useCurrentCliConfigConnection({
  enabledProvider,
  selectedCliTool,
  currentProviderConfig,
  apiGatewayProvider
}: {
  enabledProvider?: Provider
  selectedCliTool: CodeCli
  currentProviderConfig?: CliProviderConfig | null
  apiGatewayProvider?: ApiGatewayProviderBundle | null
}): [CliConfigConnection | null, (connection: CliConfigConnection | null) => void] {
  const [currentCliConfigConnection, setCurrentCliConfigConnection] = useState<CliConfigConnection | null>(null)
  const { models } = useModels({ enabled: true })

  const isGateway = !!enabledProvider && isApiGatewayProviderId(enabledProvider.id)
  const gatewayApiKey = apiGatewayProvider?.apiKey ?? null
  // Resolve the gateway model's apiModelId to a primitive so the effect re-runs only when it changes.
  const gatewayApiModelId = useMemo(() => {
    if (!isGateway) return undefined
    const modelId = currentProviderConfig?.modelId
    return modelId ? models.find((m) => m.id === modelId)?.apiModelId : undefined
  }, [isGateway, currentProviderConfig?.modelId, models])

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
      // Gateway: match against the synthetic gateway key (no DataApi record) and the gateway-addressed
      // model, so a live gateway config lights up as active rather than showing as a foreign connection.
      let apiKeys: ApiKeyEntry[]
      let expectedModel: string | undefined
      if (isGateway) {
        apiKeys = gatewayApiKey ? [{ id: 'gateway', key: gatewayApiKey, isEnabled: true }] : []
        expectedModel = gatewayExpectedModel(currentProviderConfig?.modelId, gatewayApiModelId)
      } else {
        apiKeys = await readProviderApiKeys(enabledProvider.id)
        const currentCliConfigContext = resolveCliConfigApplyContext(
          selectedCliTool,
          enabledProvider.id,
          currentProviderConfig ?? undefined
        )
        expectedModel = currentCliConfigContext?.writePrimaryModel ? currentCliConfigContext.rawModelId : undefined
      }
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
  }, [enabledProvider, selectedCliTool, currentProviderConfig, isGateway, gatewayApiKey, gatewayApiModelId])

  return [currentCliConfigConnection, setCurrentCliConfigConnection]
}
