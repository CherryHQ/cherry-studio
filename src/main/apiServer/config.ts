import { ApiServerConfig } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { loggerService } from '../services/LoggerService'
import { reduxService } from '../services/ReduxService'

const logger = loggerService.withContext('ApiServerConfig')

class ConfigManager {
  private _config: ApiServerConfig | null = null

  async load(): Promise<ApiServerConfig> {
    try {
      const settings = await reduxService.select('state.settings')

      // Auto-generate API key if not set
      if (!settings?.apiServer?.apiKey) {
        const generatedKey = `cs-sk-${uuidv4()}`
        await reduxService.dispatch({
          type: 'settings/setApiServerApiKey',
          payload: generatedKey
        })

        this._config = {
          enabled: settings?.apiServer?.enabled ?? false,
          port: settings?.apiServer?.port ?? 23333,
          host: 'localhost',
          apiKey: generatedKey
        }
      } else {
        this._config = {
          enabled: settings?.apiServer?.enabled ?? false,
          port: settings?.apiServer?.port ?? 23333,
          host: 'localhost',
          apiKey: settings.apiServer.apiKey
        }
      }

      return this._config
    } catch (error: any) {
      logger.warn('Failed to load config from Redux, using defaults:', error)
      this._config = {
        enabled: false,
        port: 23333,
        host: 'localhost',
        apiKey: `cs-sk-${uuidv4()}`
      }
      return this._config
    }
  }

  async get(): Promise<ApiServerConfig> {
    if (!this._config) {
      await this.load()
    }
    if (!this._config) {
      throw new Error('Failed to load API server configuration')
    }
    return this._config
  }

  async reload(): Promise<ApiServerConfig> {
    return await this.load()
  }
}

export const config = new ConfigManager()
