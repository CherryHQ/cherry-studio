import { API_GATEWAY_DEFAULTS } from '@shared/config/constant'
import type { ApiGatewayConfig, GatewayEndpoint } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { loggerService } from '../services/LoggerService'
import { reduxService } from '../services/ReduxService'

const logger = loggerService.withContext('ApiGatewayConfig')

const DEFAULT_ENABLED_ENDPOINTS: GatewayEndpoint[] = ['/v1/chat/completions', '/v1/messages', '/v1/responses']

class ConfigManager {
  private _config: ApiGatewayConfig | null = null

  private generateApiKey(): string {
    return `cs-sk-${uuidv4()}`
  }

  async load(): Promise<ApiGatewayConfig> {
    try {
      const settings = await reduxService.select('state.settings')
      const serverSettings = settings?.apiGateway
      let apiKey = serverSettings?.apiKey
      if (!apiKey || apiKey.trim() === '') {
        apiKey = this.generateApiKey()
        await reduxService.dispatch({
          type: 'settings/setApiGatewayApiKey',
          payload: apiKey
        })
      }
      this._config = {
        enabled: serverSettings?.enabled ?? false,
        port: serverSettings?.port ?? API_GATEWAY_DEFAULTS.PORT,
        host: serverSettings?.host ?? API_GATEWAY_DEFAULTS.HOST,
        apiKey: apiKey,
        modelGroups: serverSettings?.modelGroups ?? [],
        enabledEndpoints: serverSettings?.enabledEndpoints ?? DEFAULT_ENABLED_ENDPOINTS,
        exposeToNetwork: serverSettings?.exposeToNetwork ?? false
      }
      return this._config
    } catch (error: any) {
      logger.warn('Failed to load config from Redux, using defaults', { error })
      this._config = {
        enabled: false,
        port: API_GATEWAY_DEFAULTS.PORT,
        host: API_GATEWAY_DEFAULTS.HOST,
        apiKey: this.generateApiKey(),
        modelGroups: [],
        enabledEndpoints: DEFAULT_ENABLED_ENDPOINTS,
        exposeToNetwork: false
      }
      return this._config
    }
  }

  async get(): Promise<ApiGatewayConfig> {
    // Always reload to get fresh config from Redux
    // This ensures UI changes (like group ID updates) are reflected immediately
    return await this.load()
  }

  async reload(): Promise<ApiGatewayConfig> {
    return await this.load()
  }
}

export const config = new ConfigManager()
