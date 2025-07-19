import { v4 as uuidv4 } from 'uuid'

import { loggerService } from '../services/LoggerService'
import { reduxService } from '../services/ReduxService'

const logger = loggerService.withContext('ApiServerConfig')

export interface Config {
  port: number
  host: string
  apiKey: string
}

class ConfigManager {
  private _config: Config | null = null

  async load(): Promise<Config> {
    try {
      const settings = await reduxService.select('state.settings')

      // Auto-generate API key if not set
      if (!settings?.apiServer?.apiKey) {
        const generatedKey = `sk-${uuidv4()}`
        await reduxService.dispatch({
          type: 'settings/setApiServerApiKey',
          payload: generatedKey
        })

        this._config = {
          port: settings?.apiServer?.port ?? 13333,
          host: 'localhost',
          apiKey: generatedKey
        }
      } else {
        this._config = {
          port: settings?.apiServer?.port ?? 13333,
          host: 'localhost',
          apiKey: settings.apiServer.apiKey
        }
      }

      return this._config
    } catch (error) {
      logger.warn('Failed to load config from Redux, using defaults:', error)
      this._config = {
        port: 13333,
        host: 'localhost',
        apiKey: `sk-${uuidv4()}`
      }
      return this._config
    }
  }

  get(): Config {
    if (!this._config) {
      throw new Error('Config not loaded. Call load() first.')
    }
    return this._config
  }

  async reload(): Promise<Config> {
    return this.load()
  }
}

export const config = new ConfigManager()
