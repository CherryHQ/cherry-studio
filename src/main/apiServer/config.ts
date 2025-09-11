import { ApiServerConfig } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { loggerService } from '../services/LoggerService'
import { reduxService } from '../services/ReduxService'

const logger = loggerService.withContext('ApiServerConfig')

const defaultHost = 'localhost'
const defaultPort = 23333

class ConfigManager {
  private _config: ApiServerConfig | null = null

  private generateApiKey(): string {
    return `cs-sk-${uuidv4()}`
  }

  async load(): Promise<ApiServerConfig> {
    try {
      const settings = await reduxService.select('state.settings')
      const serverSettings = settings?.apiServer
      let apiKey = serverSettings?.apiKey
      if (!apiKey || apiKey.trim() === '') {
        apiKey = this.generateApiKey()
        await reduxService.dispatch({
          type: 'settings/setApiServerApiKey',
          payload: apiKey
        })
      }
      this._config = {
        enabled: serverSettings?.enabled ?? false,
        port: serverSettings?.port ?? defaultPort,
        host: defaultHost,
        apiKey: apiKey
      }
      return this._config
    } catch (error: any) {
      logger.warn('Failed to load config from Redux, using defaults:', error)
      this._config = {
        enabled: false,
        port: defaultPort,
        host: defaultHost,
        apiKey: this.generateApiKey()
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
