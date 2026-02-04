import { loggerService } from '@logger'
import { EXTERNAL_APPS } from '@shared/externalApp/config'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { app } from 'electron'

const logger = loggerService.withContext('ExternalAppsService')

class ExternalAppsService {
  private cache: { apps: ExternalAppInfo[]; timestamp: number } | null = null
  private readonly CACHE_DURATION = 1000 * 60 * 5 // 5 minutes

  async detectInstalledApps(): Promise<ExternalAppInfo[]> {
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_DURATION) {
      return this.cache.apps
    }

    const results = (
      await Promise.all(
        EXTERNAL_APPS.map(async (appConfig) => {
          try {
            const info = await app.getApplicationInfoForProtocol(appConfig.protocol)
            const installed = !!info.name
            if (!installed) {
              return null
            }
            logger.info(`Detected ${appConfig.name} at ${info.path}`)

            return {
              ...appConfig,
              path: info.path
            }
          } catch (error) {
            logger.debug(`Failed to detect ${appConfig.name}:`, error as Error)
            return null
          }
        })
      )
    ).filter((result) => result !== null)

    this.cache = { apps: results, timestamp: Date.now() }
    return results
  }
}

export const externalAppsService = new ExternalAppsService()
