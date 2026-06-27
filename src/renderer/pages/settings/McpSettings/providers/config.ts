import type { CompoundIcon } from '@cherrystudio/ui'
import { Bailian, Modelscope } from '@cherrystudio/ui/icons'
import type { McpServer } from '@shared/data/types/mcpServer'

import { getBailianToken, saveBailianToken, syncBailianServers } from './bailian'
import { getModelScopeToken, MODELSCOPE_HOST, saveModelScopeToken, syncModelScopeServers } from './modelscope'

export interface SyncResult {
  success: boolean
  message: string
  allServers: McpServer[]
}

export interface ProviderConfig {
  key: string
  /** i18n key for provider name, or plain text if not starting with 'provider.' */
  nameKey: string
  /** i18n key for provider description */
  descriptionKey: string
  discoverUrl: string
  apiKeyUrl: string
  tokenFieldName: string
  getToken: () => string | null
  saveToken: (token: string) => void
  syncServers: (token: string) => Promise<SyncResult>
}

export const providers: ProviderConfig[] = [
  {
    key: 'bailian',
    nameKey: 'provider.dashscope',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.bailian',
    discoverUrl: `https://bailian.console.aliyun.com/?tab=mcp#/mcp-market`,
    apiKeyUrl: `https://bailian.console.aliyun.com/?tab=app#/api-key`,
    tokenFieldName: 'bailianToken',
    getToken: getBailianToken,
    saveToken: saveBailianToken,
    syncServers: syncBailianServers
  },
  {
    key: 'modelscope',
    nameKey: 'ModelScope',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.modelscope',
    discoverUrl: `${MODELSCOPE_HOST}/mcp?hosted=1&page=1`,
    apiKeyUrl: `${MODELSCOPE_HOST}/my/myaccesstoken`,
    tokenFieldName: 'modelScopeToken',
    getToken: getModelScopeToken,
    saveToken: saveModelScopeToken,
    syncServers: syncModelScopeServers
  }
]

/**
 * Helper function to get the display name for a provider.
 * Translates if nameKey starts with 'provider.', otherwise returns as-is.
 */
export const getProviderDisplayName = (provider: ProviderConfig, t: (key: string) => string): string => {
  return provider.nameKey.startsWith('provider.') ? t(provider.nameKey) : provider.nameKey
}

const MCP_PROVIDER_ICONS: Record<string, CompoundIcon> = {
  modelscope: Modelscope,
  bailian: Bailian
}

export function getMcpProviderLogo(providerKey: string): CompoundIcon | undefined {
  return MCP_PROVIDER_ICONS[providerKey]
}
