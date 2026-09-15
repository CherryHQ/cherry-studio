import { app, dialog } from 'electron'

import { classifyDatabaseFailure } from '@data/db/startupErrors'
import { loggerService } from '@logger'
import { SUPPORTED_LANGUAGES, t } from '@main/i18n'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'

const logger = loggerService.withContext('StartupRecovery')

/** Runs without PreferenceService, DbService or WindowManager. Retry always means a fresh process. */
export async function showStartupRecovery(error: unknown): Promise<'retry' | 'exit'> {
  await app.whenReady()
  const locale = app.getLocale() as LanguageVarious
  const language = SUPPORTED_LANGUAGES.includes(locale) ? locale : defaultLanguage
  const failure = classifyDatabaseFailure(error)
  const messages = {
    busy: t('dialog.startup_recovery.busy', undefined, language),
    io: t('dialog.startup_recovery.io', undefined, language),
    access: t('dialog.startup_recovery.access', undefined, language),
    full: t('dialog.startup_recovery.full', undefined, language),
    corrupt: t('dialog.startup_recovery.corrupt', undefined, language),
    unknown: t('dialog.startup_recovery.unknown', undefined, language)
  }
  const title = t('dialog.startup_recovery.title', undefined, language)
  logger.error('Startup blocked', {
    kind: failure.kind,
    code: failure.code,
    pid: process.pid,
    version: app.getVersion(),
    error
  })

  while (true) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title,
      message: messages[failure.kind],
      detail: `${t('dialog.startup_recovery.detail', undefined, language)}${failure.code ? `\n\n${failure.code}` : ''}`,
      buttons: [
        t('dialog.startup_recovery.retry', undefined, language),
        t('dialog.diagnostic_bundle.title', undefined, language),
        t('appMenu.quit', undefined, language)
      ],
      defaultId: failure.kind === 'corrupt' ? 1 : 0,
      cancelId: 2,
      noLink: true
    })
    if (response !== 1) return response === 0 ? 'retry' : 'exit'

    try {
      const { diagnosticBundleService } = await import('./diagnostics')
      const result = await diagnosticBundleService.exportStartupBundle(language)
      if (result.status === 'saved') {
        await dialog.showMessageBox({
          type: 'info',
          title,
          message: t('dialog.startup_recovery.saved', undefined, language),
          detail: result.filePath
        })
      } else if (result.status === 'busy') {
        throw new Error('Diagnostic export already in progress')
      }
    } catch (exportError) {
      logger.error('Startup diagnostic export failed', exportError as Error)
      await dialog.showMessageBox({
        type: 'warning',
        title,
        message: t('dialog.startup_recovery.export_failed', undefined, language)
      })
    }
  }
}
