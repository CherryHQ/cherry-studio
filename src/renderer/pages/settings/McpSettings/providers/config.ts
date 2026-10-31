import { MCP_PROVIDER_ENTRIES } from '@renderer/utils/mcpDiscovery'
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
  discoverUrl: string
  apiKeyUrl: string
  tokenFieldName: string
  getToken: () => string | null
  saveToken: (token: string) => void
  syncServers: (token: string) => Promise<SyncResult>
}

export const providers: ProviderConfig[] = [
  {
    ...MCP_PROVIDER_ENTRIES[0],
    discoverUrl: `https://bailian.console.aliyun.com/?tab=mcp#/mcp-market`,
    apiKeyUrl: `https://bailian.console.aliyun.com/?tab=app#/api-key`,
    tokenFieldName: 'bailianToken',
    getToken: getBailianToken,
    saveToken: saveBailianToken,
    syncServers: syncBailianServers
  },
  {
    ...MCP_PROVIDER_ENTRIES[1],
    discoverUrl: `${MODELSCOPE_HOST}/mcp?hosted=1&page=1`,
    apiKeyUrl: `${MODELSCOPE_HOST}/my/myaccesstoken`,
    tokenFieldName: 'modelScopeToken',
    getToken: getModelScopeToken,
    saveToken: saveModelScopeToken,
    syncServers: syncModelScopeServers
  }
]

export { getProviderDisplayName, getMcpProviderLogo } from '@renderer/utils/mcpDiscovery'
