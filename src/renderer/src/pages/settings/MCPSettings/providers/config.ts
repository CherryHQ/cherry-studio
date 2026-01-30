import type { MCPServer } from '@renderer/types'

import { getAI302Token, saveAI302Token, syncAi302Servers } from './302ai'
import { getBailianToken, saveBailianToken, syncBailianServers } from './bailian'
import { getTokenLanYunToken, LANYUN_KEY_HOST, saveTokenLanYunToken, syncTokenLanYunServers } from './lanyun'
import { getMCPRouterToken, saveMCPRouterToken, syncMCPRouterServers } from './mcprouter'
import { getModelScopeToken, MODELSCOPE_HOST, saveModelScopeToken, syncModelScopeServers } from './modelscope'
import { getTokenFluxToken, saveTokenFluxToken, syncTokenFluxServers, TOKENFLUX_HOST } from './tokenflux'

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
  syncServers: (token: string, existingServers: MCPServer[]) => Promise<any>
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
  },
  {
    key: 'tokenflux',
    nameKey: 'TokenFlux',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.tokenflux',
    discoverUrl: `${TOKENFLUX_HOST}/mcps`,
    apiKeyUrl: `${TOKENFLUX_HOST}/dashboard/api-keys`,
    tokenFieldName: 'tokenfluxToken',
    getToken: getTokenFluxToken,
    saveToken: saveTokenFluxToken,
    syncServers: syncTokenFluxServers
  },
  {
    key: 'lanyun',
    nameKey: 'provider.lanyun',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.lanyun',
    discoverUrl: 'https://mcp.lanyun.net',
    apiKeyUrl: LANYUN_KEY_HOST,
    tokenFieldName: 'tokenLanyunToken',
    getToken: getTokenLanYunToken,
    saveToken: saveTokenLanYunToken,
    syncServers: syncTokenLanYunServers
  },
  {
    key: '302ai',
    nameKey: '302.AI',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.302ai',
    discoverUrl: 'https://302.ai',
    apiKeyUrl: 'https://dash.302.ai/apis/list',
    tokenFieldName: 'token302aiToken',
    getToken: getAI302Token,
    saveToken: saveAI302Token,
    syncServers: syncAi302Servers
  },
  {
    key: 'mcprouter',
    nameKey: 'MCP Router',
    descriptionKey: 'settings.mcp.sync.providerDescriptions.mcprouter',
    discoverUrl: 'https://mcprouter.co',
    apiKeyUrl: 'https://mcprouter.co/settings/keys',
    tokenFieldName: 'mcprouterToken',
    getToken: getMCPRouterToken,
    saveToken: saveMCPRouterToken,
    syncServers: syncMCPRouterServers
  }
]

/**
 * Helper function to get the display name for a provider.
 * Translates if nameKey starts with 'provider.', otherwise returns as-is.
 */
export const getProviderDisplayName = (provider: ProviderConfig, t: (key: string) => string): string => {
  return provider.nameKey.startsWith('provider.') ? t(provider.nameKey) : provider.nameKey
}
