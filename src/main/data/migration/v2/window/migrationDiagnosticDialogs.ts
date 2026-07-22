import { application } from '@application'
import { loggerService } from '@logger'
import {
  getMigrationDiagnosticNoticeParts,
  type MigrationDiagnosticRuntime,
  type MigrationDiagnosticSavedResult,
  type MigrationDiagnosticSaveResult
} from '@shared/data/migration/v2/diagnostics'
import type { Event as ElectronEvent, MessageBoxOptions } from 'electron'
import { app, dialog } from 'electron'

import { MigrationDiagnosticBundleBuilder, type MigrationDiagnosticContext } from '../diagnostics'
import {
  createMigrationDiagnosticNativeI18n,
  type MigrationDiagnosticNativeI18n
} from './migrationDiagnosticNativeI18n'

const DIAGNOSTIC_BUNDLE_FILE_NAME = 'cherry-studio-migration-diagnostics.zip'
const MIGRATION_DIAGNOSTIC_PROCESS_IDENTITY = Object.freeze({
  processId: process.pid,
  processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
}) satisfies Omit<MigrationDiagnosticRuntime, 'userDataPath'>
const logger = loggerService.withContext('MigrationDiagnosticDialogs')

type BundleSaveResult = Awaited<ReturnType<MigrationDiagnosticBundleBuilder['save']>>
type SaveBundle = (input: {
  readonly destination: string
  readonly logsDirectory: string
  readonly context: MigrationDiagnosticContext
}) => Promise<BundleSaveResult>

interface MigrationDiagnosticDialogDependencies {
  readonly locale?: string
  readonly saveBundle?: SaveBundle
  readonly userDataPath?: string
}

export interface MigrationDiagnosticBundleDialogOutcome {
  readonly result: MigrationDiagnosticSaveResult
  readonly destination?: string
}

export interface MigrationDiagnosticFailureDialog {
  readonly type: MessageBoxOptions['type']
  readonly title: string
  readonly message: string
  readonly detail?: string
  readonly buttons: readonly string[]
  readonly defaultId: number
  readonly cancelId: number
}

export interface MigrationDiagnosticFailurePresentation {
  readonly locale: string
  readonly context: MigrationDiagnosticContext
  readonly failure: MigrationDiagnosticFailureDialog
}

const NOTICE_KEYS = {
  logs_included: 'notice.logsIncluded',
  logs_not_included_retry_suggested: 'notice.logsNotIncludedRetrySuggested',
  logs_not_included_retry_not_suggested: 'notice.logsNotIncludedRetryNotSuggested',
  not_transmitted: 'notice.notTransmitted',
  attachment_required: 'notice.attachmentRequired',
  attachment_required_large: 'notice.attachmentRequiredLarge'
} as const

export function createMigrationDiagnosticSavedDetail(
  result: MigrationDiagnosticSavedResult,
  i18n: MigrationDiagnosticNativeI18n
): string {
  return getMigrationDiagnosticNoticeParts(result)
    .map((part) => i18n.t(NOTICE_KEYS[part]))
    .join('\n\n')
}

export async function saveMigrationDiagnosticBundleWithDialog(
  context: MigrationDiagnosticContext,
  dependencies: MigrationDiagnosticDialogDependencies = {}
): Promise<MigrationDiagnosticBundleDialogOutcome> {
  const i18n = await createMigrationDiagnosticNativeI18n(dependencies.locale ?? app.getLocale())
  const logsDirectory = application.getPath('app.logs')
  let selected: Awaited<ReturnType<typeof dialog.showSaveDialog>>

  try {
    selected = await dialog.showSaveDialog({
      title: i18n.t('save.title'),
      defaultPath: application.getPath('app.logs', DIAGNOSTIC_BUNDLE_FILE_NAME),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
  } catch {
    return { result: { status: 'failed', code: 'dialog_failed' } }
  }

  if (selected.canceled || !selected.filePath) return { result: { status: 'canceled' } }

  try {
    const saveBundle = dependencies.saveBundle ?? ((input) => new MigrationDiagnosticBundleBuilder().save(input))
    const result = await saveBundle({
      destination: selected.filePath,
      logsDirectory,
      context: {
        ...context,
        runtime: {
          ...MIGRATION_DIAGNOSTIC_PROCESS_IDENTITY,
          ...(dependencies.userDataPath === undefined ? {} : { userDataPath: dependencies.userDataPath })
        }
      }
    })
    if (result.status !== 'saved') return { result: { status: 'failed', code: 'bundle_save_failed' } }
    return { result, destination: selected.filePath }
  } catch {
    return { result: { status: 'failed', code: 'bundle_save_failed' } }
  }
}

async function saveNativeMigrationDiagnosticBundleWithQuitDeferral(
  context: MigrationDiagnosticContext,
  dependencies: MigrationDiagnosticDialogDependencies
): Promise<{ outcome: MigrationDiagnosticBundleDialogOutcome; quitRequested: boolean }> {
  let quitRequested = false
  const handleBeforeQuit = (event: ElectronEvent): void => {
    event.preventDefault()
    if (quitRequested) return
    quitRequested = true
    logger.info('Quit requested during native diagnostic save; deferring until the save settles')
  }

  app.on('before-quit', handleBeforeQuit)
  try {
    const outcome = await saveMigrationDiagnosticBundleWithDialog(context, dependencies)
    return { outcome, quitRequested }
  } finally {
    app.removeListener('before-quit', handleBeforeQuit)
  }
}

function originalResponse(response: number, failure: MigrationDiagnosticFailureDialog): number {
  return response >= 0 && response < failure.buttons.length ? response : failure.cancelId
}

async function showFailureWithSave(
  failure: MigrationDiagnosticFailureDialog,
  i18n: MigrationDiagnosticNativeI18n
): Promise<number> {
  const response = await dialog.showMessageBox({
    ...failure,
    buttons: [i18n.t('action.save'), ...failure.buttons],
    defaultId: failure.defaultId + 1,
    cancelId: failure.cancelId + 1
  })
  return response.response
}

async function showSaveOutcome(
  result: Exclude<MigrationDiagnosticSaveResult, { status: 'canceled' }>,
  failure: MigrationDiagnosticFailureDialog,
  i18n: MigrationDiagnosticNativeI18n
): Promise<number | 'save_again'> {
  const saved = result.status === 'saved'
  const saveAgain = saved && result.logs === 'not_included' && result.retry === 'suggested'
  const response = await dialog.showMessageBox({
    type: saved ? 'info' : 'error',
    title: i18n.t(saved ? 'save.savedTitle' : 'save.failedTitle'),
    message: i18n.t(saved ? 'save.savedMessage' : 'save.failedMessage'),
    ...(saved ? { detail: createMigrationDiagnosticSavedDetail(result, i18n) } : {}),
    buttons: [...(saveAgain ? [i18n.t('action.saveAgain')] : []), ...failure.buttons],
    defaultId: saveAgain ? 0 : failure.defaultId,
    cancelId: failure.cancelId + (saveAgain ? 1 : 0)
  })
  if (saveAgain && response.response === 0) return 'save_again'
  return originalResponse(response.response - (saveAgain ? 1 : 0), failure)
}

async function showOriginalFailure(failure: MigrationDiagnosticFailureDialog): Promise<number> {
  try {
    const response = await dialog.showMessageBox({ ...failure, buttons: [...failure.buttons] })
    return originalResponse(response.response, failure)
  } catch (error) {
    logger.warn('Failed to present the original migration failure dialog', error as Error)
    return failure.cancelId
  }
}

export async function presentMigrationDiagnosticFailure(
  presentation: MigrationDiagnosticFailurePresentation,
  dependencies: Omit<MigrationDiagnosticDialogDependencies, 'locale'> = {}
): Promise<number> {
  try {
    const i18n = await createMigrationDiagnosticNativeI18n(presentation.locale)

    while (true) {
      const response = await showFailureWithSave(presentation.failure, i18n)
      if (response !== 0) return originalResponse(response - 1, presentation.failure)

      while (true) {
        const { outcome, quitRequested } = await saveNativeMigrationDiagnosticBundleWithQuitDeferral(
          presentation.context,
          {
            ...dependencies,
            locale: presentation.locale
          }
        )
        if (quitRequested) return presentation.failure.cancelId
        if (outcome.result.status === 'canceled') break
        const decision = await showSaveOutcome(outcome.result, presentation.failure, i18n)
        if (decision === 'save_again') continue
        return decision
      }
    }
  } catch (error) {
    logger.warn('Migration diagnostic presentation failed; falling back to the original dialog', error as Error)
    return showOriginalFailure(presentation.failure)
  }
}
