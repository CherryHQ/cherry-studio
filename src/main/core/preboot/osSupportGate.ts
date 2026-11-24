import os from 'node:os'

import { app, dialog } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { resolveSystemLanguage, t } from '@main/i18n'
import { defaultLanguage } from '@shared/utils/languages'
import {
  MIN_SUPPORTED_WINDOWS_VERSION_LABEL,
  WINDOWS_SUPPORT_RELEASES_URL,
  isSupportedWindowsRelease
} from '@shared/utils/osSupport'

const logger = loggerService.withContext('OsSupportGate')

function currentOsReleaseLabel(osRelease: string): string {
  if (process.platform !== 'win32') return process.platform
  return `Windows (NT ${osRelease})`
}

function resolveGateLanguage() {
  try {
    return resolveSystemLanguage(app.getLocale())
  } catch {
    return defaultLanguage
  }
}

/**
 * Block startup on unsupported Windows releases before any userData work.
 *
 * Timing contract:
 *   - Must run BEFORE `resolveUserDataLocation()` in `main/main.ts`. It only
 *     reads `os.release()` / `process.platform` and shows a modal — it never
 *     touches the filesystem, BootConfig, or the path registry, so an
 *     unsupported machine exits without modifying user data.
 *   - Synchronous on purpose: the preboot sequence at the top of `main.ts`
 *     runs before `app.whenReady()`. `dialog.showErrorBox` works pre-ready,
 *     so no lifecycle service or `await app.whenReady()` is needed here.
 *
 * Returns 'handled' when this launch must stop, 'skipped' otherwise.
 */
export function runOsSupportGate(): 'handled' | 'skipped' {
  if (process.platform !== 'win32') return 'skipped'
  let osRelease = ''
  try {
    osRelease = os.release()
  } catch (error) {
    logger.warn('Could not read OS release; skipping Windows version gate', error as Error)
    return 'skipped'
  }
  if (isSupportedWindowsRelease(osRelease, process.platform)) return 'skipped'

  logger.warn(`Unsupported Windows release ${osRelease}; refusing to start`, {
    osRelease,
    minimum: MIN_SUPPORTED_WINDOWS_VERSION_LABEL
  })
  try {
    const language = resolveGateLanguage()
    dialog.showErrorBox(
      t('dialog.os_unsupported.title', undefined, language),
      `${t(
        'dialog.os_unsupported.detail',
        { osRelease: currentOsReleaseLabel(osRelease), minimum: MIN_SUPPORTED_WINDOWS_VERSION_LABEL },
        language
      )}\n\n${WINDOWS_SUPPORT_RELEASES_URL}`
    )
  } catch (error) {
    logger.error('Failed to show unsupported-OS dialog', error as Error)
  }
  application.quit()
  process.exit(1)
  return 'handled'
}
