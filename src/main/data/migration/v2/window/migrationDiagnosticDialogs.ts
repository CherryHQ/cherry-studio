import { application } from '@application'
import {
  getMigrationDiagnosticNoticeParts,
  type MigrationDiagnosticSavedResult,
  type MigrationDiagnosticSaveResult
} from '@shared/data/migration/v2/diagnostics'
import type { MessageBoxOptions } from 'electron'
import { app, dialog } from 'electron'

import { MigrationDiagnosticBundleBuilder, type MigrationDiagnosticContext } from '../diagnostics'
import {
  createMigrationDiagnosticNativeI18n,
  type MigrationDiagnosticNativeI18n
} from './migrationDiagnosticNativeI18n'

const DIAGNOSTIC_BUNDLE_FILE_NAME = 'cherry-studio-migration-diagnostics.zip'

type BundleSaveResult = Awaited<ReturnType<MigrationDiagnosticBundleBuilder['save']>>
type SaveBundle = (input: {
  readonly destination: string
  readonly logsDirectory: string
  readonly context: MigrationDiagnosticContext
}) => Promise<BundleSaveResult>

interface MigrationDiagnosticDialogDependencies {
  readonly locale?: string
  readonly saveBundle?: SaveBundle
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
  logs_not_included: 'notice.logsNotIncluded',
  large: 'notice.large',
  not_uploaded: 'notice.notUploaded'
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
    const result = await saveBundle({ destination: selected.filePath, logsDirectory, context })
    if (result.status !== 'saved') return { result: { status: 'failed', code: 'bundle_save_failed' } }
    return { result, destination: selected.filePath }
  } catch {
    return { result: { status: 'failed', code: 'bundle_save_failed' } }
  }
}

function originalResponse(response: number, failure: MigrationDiagnosticFailureDialog): number {
  return response >= 0 && response < failure.buttons.length ? response : failure.cancelId
}

async function showFailureWithSave(
  failure: MigrationDiagnosticFailureDialog,
  i18n: MigrationDiagnosticNativeI18n
): Promise<number> {
  try {
    const response = await dialog.showMessageBox({
      ...failure,
      buttons: [i18n.t('action.save'), ...failure.buttons],
      defaultId: failure.defaultId + 1,
      cancelId: failure.cancelId + 1
    })
    return response.response
  } catch {
    return failure.cancelId + 1
  }
}

async function showSaveOutcome(
  result: Exclude<MigrationDiagnosticSaveResult, { status: 'canceled' }>,
  failure: MigrationDiagnosticFailureDialog,
  i18n: MigrationDiagnosticNativeI18n
): Promise<number> {
  const saved = result.status === 'saved'
  try {
    const response = await dialog.showMessageBox({
      type: saved ? 'info' : 'error',
      title: i18n.t(saved ? 'save.savedTitle' : 'save.failedTitle'),
      message: i18n.t(saved ? 'save.savedMessage' : 'save.failedMessage'),
      ...(saved ? { detail: createMigrationDiagnosticSavedDetail(result, i18n) } : {}),
      buttons: [...failure.buttons],
      defaultId: failure.defaultId,
      cancelId: failure.cancelId
    })
    return originalResponse(response.response, failure)
  } catch {
    return failure.cancelId
  }
}

export async function presentMigrationDiagnosticFailure(
  presentation: MigrationDiagnosticFailurePresentation,
  dependencies: Omit<MigrationDiagnosticDialogDependencies, 'locale'> = {}
): Promise<number> {
  const i18n = await createMigrationDiagnosticNativeI18n(presentation.locale)

  while (true) {
    const response = await showFailureWithSave(presentation.failure, i18n)
    if (response !== 0) return originalResponse(response - 1, presentation.failure)

    const outcome = await saveMigrationDiagnosticBundleWithDialog(presentation.context, {
      ...dependencies,
      locale: presentation.locale
    })
    if (outcome.result.status === 'canceled') continue
    return showSaveOutcome(outcome.result, presentation.failure, i18n)
  }
}
