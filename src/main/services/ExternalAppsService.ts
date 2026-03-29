import os from 'node:os'

import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import type { TerminalConfigWithCommand } from '@shared/config/constant'
import { MACOS_TERMINALS_WITH_COMMANDS, terminalApps, WINDOWS_TERMINALS_WITH_COMMANDS } from '@shared/config/constant'
import { EXTERNAL_APPS } from '@shared/externalApp/config'
import type { ExternalAppInfo } from '@shared/externalApp/types'
import { spawn } from 'child_process'
import { app } from 'electron'

import { codeToolsService } from './CodeToolsService'

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

  async openTerminal(
    _: Electron.IpcMainInvokeEvent,
    directory: string,
    terminalId?: string
  ): Promise<{ success: boolean; message: string }> {
    const platform = os.platform()
    logger.info(`Opening terminal at directory: ${directory}, terminalId: ${terminalId}`)

    try {
      const terminalConfig = await this.getTerminalConfig(terminalId)
      logger.info(`Using terminal: ${terminalConfig.name} (${terminalConfig.id})`)

      const safeDir = directory.replace(/"/g, '\\"')
      let terminalCommand: string
      let terminalArgs: string[]

      if (platform === 'darwin') {
        const fullCommand = `cd "${safeDir}" && clear && exec $SHELL`
        const result = terminalConfig.command(directory, fullCommand)
        terminalCommand = result.command
        terminalArgs = result.args
      } else if (platform === 'win32') {
        const fullCommand = `cd /d "${directory}"`
        const result = terminalConfig.command(directory, fullCommand)
        terminalCommand = terminalConfig.customPath || result.command
        terminalArgs = result.args
      } else {
        terminalCommand = 'xterm'
        terminalArgs = ['-e', `cd "${safeDir}" && exec bash`]
      }

      spawn(terminalCommand, terminalArgs, {
        detached: true,
        stdio: 'ignore',
        cwd: directory,
        shell: isWin
      })

      const msg = `Opened terminal ${terminalConfig.name} at ${directory}`
      logger.info(msg)
      return { success: true, message: msg }
    } catch (error) {
      const msg = `Failed to open terminal: ${error instanceof Error ? error.message : String(error)}`
      logger.error(msg, error as Error)
      return { success: false, message: msg }
    }
  }

  private async getTerminalConfig(terminalId?: string): Promise<TerminalConfigWithCommand> {
    const availableTerminals = await codeToolsService.getAvailableTerminalsForPlatform()
    const terminalCommands = isWin ? WINDOWS_TERMINALS_WITH_COMMANDS : MACOS_TERMINALS_WITH_COMMANDS
    const defaultTerminal = isWin ? terminalApps.cmd : terminalApps.systemDefault

    if (terminalId) {
      const requestedTerminal = terminalCommands.find(
        (t) => t.id === terminalId && availableTerminals.some((at) => at.id === t.id)
      )

      if (requestedTerminal) {
        return requestedTerminal
      }
      logger.warn(`Requested terminal ${terminalId} not available, falling back to system default`)
    }

    return terminalCommands.find((t) => t.id === defaultTerminal) || terminalCommands[0]
  }
}

export const externalAppsService = new ExternalAppsService()
