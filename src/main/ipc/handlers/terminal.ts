import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { ConfigKeys, configManager } from '@main/services/ConfigManager'
import { autoDiscoverGitBash, getGitBashPathInfo, validateGitBashPath } from '@main/utils/process'
import type { terminalRequestSchemas } from '@shared/ipc/schemas/terminal'
import type { IpcHandlersFor } from '@shared/ipc/types'

const logger = loggerService.withContext('IPC:Terminal')

export const terminalHandlers: IpcHandlersFor<typeof terminalRequestSchemas> = {
  'terminal.check_git_bash': async () => {
    if (!isWin) {
      return true
    }

    try {
      const bashPath = autoDiscoverGitBash()
      if (bashPath) {
        logger.info('Git Bash is available', { path: bashPath })
        return true
      }

      logger.warn('Git Bash not found. Please install Git for Windows from https://git-scm.com/downloads/win')
      return false
    } catch (error) {
      logger.error('Unexpected error checking Git Bash', error as Error)
      return false
    }
  },
  'terminal.get_git_bash_path': async () => {
    if (!isWin) {
      return null
    }

    const customPath = configManager.get<string | null>(ConfigKeys.GitBashPath)
    return customPath ?? null
  },
  'terminal.get_git_bash_path_info': async () => getGitBashPathInfo(),
  'terminal.set_git_bash_path': async (newPath) => {
    if (!isWin) {
      return false
    }

    if (!newPath) {
      configManager.set(ConfigKeys.GitBashPath, null)
      configManager.set(ConfigKeys.GitBashPathSource, null)
      autoDiscoverGitBash()
      return true
    }

    const validated = validateGitBashPath(newPath)
    if (!validated) {
      return false
    }

    configManager.set(ConfigKeys.GitBashPath, validated)
    configManager.set(ConfigKeys.GitBashPathSource, 'manual')
    return true
  }
}
