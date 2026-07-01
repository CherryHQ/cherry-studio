import { loggerService } from '@logger'
import type { ExternalAppConfig, ExternalAppInfo } from '@shared/types/externalApp'
import { app } from 'electron'

const logger = loggerService.withContext('ExternalAppsService')

const EXTERNAL_APPS = [
  { id: 'vscode', name: 'Visual Studio Code', protocol: 'vscode://', tags: ['code-editor'] },
  { id: 'cursor', name: 'Cursor', protocol: 'cursor://', tags: ['code-editor'] },
  { id: 'zed', name: 'Zed', protocol: 'zed://', tags: ['code-editor'] }
] as const satisfies ExternalAppConfig[]

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
