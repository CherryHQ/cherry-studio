import { app, dialog } from 'electron'

import { application } from '@application'
import { classifyDatabaseFailure } from '@data/db/startupErrors'
import { loggerService } from '@logger'
import { resolveSystemLanguage, t } from '@main/i18n'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'

import { StartupRecoveryCanceled, withStartupRecoveryProgress } from './startupRecoveryProgress'
import { canStopDatabaseProcess, listDatabaseProcesses, stopDatabaseProcess } from './windowsRestartManager'

const logger = loggerService.withContext('StartupRecovery')

/** Runs without PreferenceService, DbService or WindowManager. Retry always means a fresh process. */
export async function showStartupRecovery(
  error: unknown,
  database = application.getPath('app.database.file'),
  instanceConflict = false
): Promise<'retry' | 'exit'> {
  await app.whenReady()
  const language = resolveSystemLanguage(app.getLocale())
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

  const inspectAvailable = process.platform === 'win32' && (failure.kind === 'busy' || failure.kind === 'io')
  while (true) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title,
      message: instanceConflict
        ? t('dialog.startup_recovery.instance_conflict', undefined, language)
        : messages[failure.kind],
      detail: `${t('dialog.startup_recovery.detail', undefined, language)}${failure.code ? `\n\n${failure.code}` : ''}`,
      buttons: [
        t('dialog.startup_recovery.retry', undefined, language),
        t('dialog.diagnostic_bundle.title', undefined, language),
        t('appMenu.quit', undefined, language),
        ...(inspectAvailable ? [t('dialog.startup_recovery.inspect', undefined, language)] : [])
      ],
      defaultId: failure.kind === 'corrupt' ? 1 : 0,
      cancelId: 2,
      noLink: true
    })
    if (response === 3 && inspectAvailable) {
      if (await resolveDatabaseProcesses(database, language)) return 'retry'
      continue
    }
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

async function resolveDatabaseProcesses(database: string, language: LanguageVarious): Promise<boolean> {
  let forcing = false
  const title = t('dialog.startup_recovery.title', undefined, language)
  try {
    const owners = await withStartupRecoveryProgress(language, (signal) => listDatabaseProcesses(database, signal))
    if (owners.length === 0) {
      await dialog.showMessageBox({
        type: 'info',
        title,
        message: t('dialog.startup_recovery.no_process', undefined, language)
      })
      return false
    }
    for (const owner of owners) {
      const detail = `${owner.name} (PID ${owner.pid})\n${owner.executable}\n${database}`
      if (!canStopDatabaseProcess(owner)) {
        await dialog.showMessageBox({
          type: 'info',
          title,
          detail,
          message: t('dialog.startup_recovery.external_process', undefined, language)
        })
        continue
      }
      const close = await dialog.showMessageBox({
        type: 'question',
        title,
        detail,
        message: t('dialog.startup_recovery.close_process', undefined, language),
        buttons: [
          t('dialog.startup_recovery.request_exit', undefined, language),
          t('dialog.startup_recovery.cancel', undefined, language)
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      if (close.response !== 0) return false
      await withStartupRecoveryProgress(language, (signal) => stopDatabaseProcess(database, owner, false, signal))
      const remaining = await withStartupRecoveryProgress(language, (signal) => listDatabaseProcesses(database, signal))
      if (remaining.some((entry) => entry.pid === owner.pid && entry.started === owner.started)) {
        const force = await dialog.showMessageBox({
          type: 'warning',
          title,
          detail,
          message: t('dialog.startup_recovery.force_warning', undefined, language),
          buttons: [
            t('dialog.startup_recovery.force_exit', undefined, language),
            t('dialog.startup_recovery.cancel', undefined, language)
          ],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        })
        if (force.response !== 0) return false
        forcing = true
        await withStartupRecoveryProgress(language, (signal) => stopDatabaseProcess(database, owner, true, signal))
        forcing = false
      }
    }
    const remaining = await withStartupRecoveryProgress(language, (signal) => listDatabaseProcesses(database, signal))
    if (remaining.length > 0) throw new Error('Database files are still in use after recovery')
    return true
  } catch (error) {
    if (error instanceof StartupRecoveryCanceled) return false
    logger.error('Database process recovery failed', error as Error)
    await dialog.showMessageBox({
      type: 'warning',
      title,
      message: forcing
        ? t('dialog.startup_recovery.force_failed', undefined, language)
        : t('dialog.startup_recovery.process_failed', undefined, language)
    })
    return false
  }
}
