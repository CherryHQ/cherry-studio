import { getProviderLabel } from '@renderer/i18n/label'
import type { MCPServer } from '@renderer/types'

import { getAI302Token, saveAI302Token, syncAi302Servers } from './302ai'
import { getBailianToken, saveBailianToken, syncBailianServers } from './bailian'
import { getTokenLanYunToken, LANYUN_KEY_HOST, saveTokenLanYunToken, syncTokenLanYunServers } from './lanyun'
import { getMCPRouterToken, saveMCPRouterToken, syncMCPRouterServers } from './mcprouter'
import { getModelScopeToken, MODELSCOPE_HOST, saveModelScopeToken, syncModelScopeServers } from './modelscope'
import { getTokenFluxToken, saveTokenFluxToken, syncTokenFluxServers, TOKENFLUX_HOST } from './tokenflux'

export interface ProviderConfig {
  key: string
  name: string
  description: string
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
    name: getProviderLabel('dashscope'),
    description: '百炼平台服务',
    discoverUrl: `https://bailian.console.aliyun.com/?tab=mcp#/mcp-market`,
    apiKeyUrl: `https://bailian.console.aliyun.com/?tab=app#/api-key`,
    tokenFieldName: 'bailianToken',
    getToken: getBailianToken,
    saveToken: saveBailianToken,
    syncServers: syncBailianServers
  },
  {
    key: 'modelscope',
    name: 'ModelScope',
    description: 'ModelScope 平台 MCP 服务',
    discoverUrl: `${MODELSCOPE_HOST}/mcp?hosted=1&page=1`,
    apiKeyUrl: `${MODELSCOPE_HOST}/my/myaccesstoken`,
    tokenFieldName: 'modelScopeToken',
    getToken: getModelScopeToken,
    saveToken: saveModelScopeToken,
    syncServers: syncModelScopeServers
  },
  {
    key: 'tokenflux',
    name: 'TokenFlux',
    description: 'TokenFlux 平台 MCP 服务',
    discoverUrl: `${TOKENFLUX_HOST}/mcps`,
    apiKeyUrl: `${TOKENFLUX_HOST}/dashboard/api-keys`,
    tokenFieldName: 'tokenfluxToken',
    getToken: getTokenFluxToken,
    saveToken: saveTokenFluxToken,
    syncServers: syncTokenFluxServers
  },
  {
    key: 'lanyun',
    name: getProviderLabel('lanyun'),
    description: '蓝耘科技云平台 MCP 服务',
    discoverUrl: 'https://mcp.lanyun.net',
    apiKeyUrl: LANYUN_KEY_HOST,
    tokenFieldName: 'tokenLanyunToken',
    getToken: getTokenLanYunToken,
    saveToken: saveTokenLanYunToken,
    syncServers: syncTokenLanYunServers
  },
  {
    key: '302ai',
    name: '302.AI',
    description: '302.AI 平台 MCP 服务',
    discoverUrl: 'https://302.ai',
    apiKeyUrl: 'https://dash.302.ai/apis/list',
    tokenFieldName: 'token302aiToken',
    getToken: getAI302Token,
    saveToken: saveAI302Token,
    syncServers: syncAi302Servers
  },
  {
    key: 'mcprouter',
    name: 'MCP Router',
    description: 'MCP Router 平台 MCP 服务',
    discoverUrl: 'https://mcprouter.co',
    apiKeyUrl: 'https://mcprouter.co/settings/keys',
    tokenFieldName: 'mcprouterToken',
    getToken: getMCPRouterToken,
    saveToken: saveMCPRouterToken,
    syncServers: syncMCPRouterServers
  }
]
