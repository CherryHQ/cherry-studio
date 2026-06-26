import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { autoDiscoverGitBash, getGitBashPathInfo, validateGitBashPath } from '@main/utils/process'
import type { systemRequestSchemas } from '@shared/ipc/schemas/system'
import type { IpcHandlersFor } from '@shared/ipc/types'

const logger = loggerService.withContext('IpcHandler:System')

/**
 * System capability handlers. The Git Bash routes are Windows-only (they no-op /
 * return null off Windows) and delegate to `@main/utils/process` + Preference.
 * They act on app-level state, not the caller window, so they ignore `IpcContext`.
 */
export const systemHandlers: IpcHandlersFor<typeof systemRequestSchemas> = {
  'system.git_bash.check': async () => {
    if (!isWin) {
      return true // Non-Windows systems don't need Git Bash
    }

    try {
      // autoDiscoverGitBash handles auto-discovery and persistence
      const bashPath = await autoDiscoverGitBash()
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

  'system.git_bash.get_path': async () => {
    if (!isWin) {
      return null
    }
    return application.get('PreferenceService').get('feature.code_cli.git_bash_path')
  },

  // getGitBashPathInfo already returns { path: null, source: null } off Windows.
  'system.git_bash.get_path_info': async () => getGitBashPathInfo(),

  'system.git_bash.set_path': async ({ path }) => {
    if (!isWin) {
      return false
    }

    const preferenceService = application.get('PreferenceService')

    if (!path) {
      // Clear manual setting and re-run auto-discovery
      await preferenceService.set('feature.code_cli.git_bash_path', null)
      await preferenceService.set('feature.code_cli.git_bash_path_source', null)
      await autoDiscoverGitBash()
      return true
    }

    const validated = validateGitBashPath(path)
    if (!validated) {
      return false
    }

    // Set path with 'manual' source
    await preferenceService.set('feature.code_cli.git_bash_path', validated)
    await preferenceService.set('feature.code_cli.git_bash_path_source', 'manual')
    return true
  }
}
