import { isProviderSettingsListVisibleProvider } from '@renderer/utils/providerSettings'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { freshModelHealth } from '@shared/utils/modelHealth'
import { hasApiKeys, isLoginBasedProvider } from '@shared/utils/provider'

export type LocalRuntimeState = 'ok' | 'down' | 'unknown'

export interface LocalRuntimeStatus {
  providerId: string
  name: string
  state: LocalRuntimeState
  checkedAt?: number
}

export interface McpLastError {
  serverName: string
  message: string
  at: number
}

export interface HealthSummary {
  providers: { enabledCount: number; connectedCount: number }
  keys: { enabledCount: number }
  models: { healthyCount: number; unhealthyCount: number; uncheckedCount: number }
  localRuntimes: LocalRuntimeStatus[]
  mcp: { installedCount: number; activeCount: number; lastError?: McpLastError }
}

/** A provider this fork can actually route to right now: a key, a credential-free local server, or a login. */
function hasUsableCredential(provider: Provider): boolean {
  if (provider.authOptional === true) return true
  if (isLoginBasedProvider(provider)) return true
  return hasApiKeys(provider)
}

/** Managed/synthetic providers are excluded — same filter the provider list and model picker already apply. */
function realEnabledProviders(providers: readonly Provider[]): Provider[] {
  return providers.filter((provider) => isProviderSettingsListVisibleProvider(provider) && provider.isEnabled)
}

function summarizeModels(
  models: readonly Model[],
  enabledProviderIds: ReadonlySet<string>,
  health: ModelHealthMemory
): { relevant: Model[]; healthyCount: number; unhealthyCount: number; uncheckedCount: number } {
  const relevant = models.filter((model) => model.isEnabled && enabledProviderIds.has(model.providerId))
  const healthyCount = relevant.filter((model) => freshModelHealth(health[model.id])?.ok === true).length
  const unhealthyCount = relevant.filter((model) => freshModelHealth(health[model.id])?.ok === false).length
  return { relevant, healthyCount, unhealthyCount, uncheckedCount: relevant.length - healthyCount - unhealthyCount }
}

/** One line per credential-free local provider (LM Studio, Ollama…), using its freshest probed model. */
function summarizeLocalRuntimes(
  enabledProviders: readonly Provider[],
  relevantModels: readonly Model[],
  health: ModelHealthMemory
): LocalRuntimeStatus[] {
  return enabledProviders
    .filter((provider) => provider.authOptional === true)
    .map((provider) => {
      const freshest = relevantModels
        .filter((model) => model.providerId === provider.id)
        .reduce<{ ok: boolean; checkedAt: number } | undefined>((latest, model) => {
          const record = freshModelHealth(health[model.id])
          if (!record) return latest
          return !latest || record.checkedAt > latest.checkedAt ? record : latest
        }, undefined)

      return {
        providerId: provider.id,
        name: provider.name,
        state: !freshest ? 'unknown' : freshest.ok ? 'ok' : 'down',
        ...(freshest && { checkedAt: freshest.checkedAt })
      }
    })
}

/** The most recent MCP server error still on record, or undefined if none is. */
function findLastMcpError(
  servers: readonly McpServer[],
  statuses: Readonly<Record<string, McpRuntimeStatus | undefined>>
): McpLastError | undefined {
  return servers.reduce<McpLastError | undefined>((latest, server) => {
    const status = statuses[server.id]
    if (status?.state !== 'error' || !status.lastError) return latest
    if (latest && latest.at >= status.lastCheckedAt) return latest
    return { serverName: server.name, message: status.lastError, at: status.lastCheckedAt }
  }, undefined)
}

/**
 * "Is my setup actually working right now" — read from state the app already records
 * (provider credentials, `chat.retry.model_health`, MCP runtime status). No probing here.
 */
export function summarizeHealth({
  providers,
  models,
  modelHealth,
  mcpServers,
  mcpStatuses
}: {
  providers: readonly Provider[]
  models: readonly Model[]
  modelHealth: ModelHealthMemory
  mcpServers: readonly McpServer[]
  mcpStatuses: Readonly<Record<string, McpRuntimeStatus | undefined>>
}): HealthSummary {
  const enabledProviders = realEnabledProviders(providers)
  const connectedCount = enabledProviders.filter(hasUsableCredential).length
  const enabledProviderIds = new Set(enabledProviders.map((provider) => provider.id))
  const enabledKeyCount = enabledProviders.reduce(
    (sum, provider) => sum + provider.apiKeys.filter((key) => key.isEnabled).length,
    0
  )
  const {
    relevant: relevantModels,
    healthyCount,
    unhealthyCount,
    uncheckedCount
  } = summarizeModels(models, enabledProviderIds, modelHealth)
  const lastError = findLastMcpError(mcpServers, mcpStatuses)

  return {
    providers: { enabledCount: enabledProviders.length, connectedCount },
    keys: { enabledCount: enabledKeyCount },
    models: { healthyCount, unhealthyCount, uncheckedCount },
    localRuntimes: summarizeLocalRuntimes(enabledProviders, relevantModels, modelHealth),
    mcp: {
      installedCount: mcpServers.length,
      activeCount: mcpServers.filter((server) => server.isActive).length,
      ...(lastError && { lastError })
    }
  }
}
