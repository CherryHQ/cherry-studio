import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isDev } from '@main/core/platform'
import { session } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer'
import { join } from 'path'

const logger = loggerService.withContext('DevtoolsExtensionService')

@Injectable('DevtoolsExtensionService')
@ServicePhase(Phase.WhenReady)
export class DevtoolsExtensionService extends BaseService {
  protected async onReady() {
    if (!isDev) return

    await Promise.all([this.installReactDevtools(), this.installDataApiDevtools()])
  }

  private async installReactDevtools() {
    try {
      const name = await installExtension(REACT_DEVELOPER_TOOLS)
      logger.info(`Added Extension: ${name}`)
    } catch (error) {
      logger.error('Failed to install React Developer Tools extension', error as Error)
    }
  }

  private async installDataApiDevtools() {
    try {
      const dataApiDevtoolsPath = join(application.getPath('app.root.resources'), 'devtools', 'data-api')
      // Loads into the default session, so every default-session BrowserWindow can inspect DataApi activity.
      const { name } = await session.defaultSession.loadExtension(dataApiDevtoolsPath)
      logger.info(`Added Extension: ${name}`)
    } catch (error) {
      logger.error('Failed to install DataApi DevTools extension', error as Error)
    }
  }
}
