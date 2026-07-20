import type { MigrationDiagnosticSaveResult } from '@shared/data/migration/v2/types'
import { dialog } from 'electron'

import {
  createMigrationDiagnosticNativeI18n,
  type MigrationDiagnosticNativeI18n
} from './migrationDiagnosticNativeI18n'

export const MIGRATION_DIAGNOSTIC_NATIVE_FAILURE_CODES = [
  'path_resolution_failed',
  'legacy_data_location_unavailable',
  'data_location_pin_failed',
  'diagnostics_journal_failed',
  'database_initialize_failed',
  'migration_status_probe_failed',
  'version_check_failed',
  'version_window_failed',
  'migration_window_failed',
  'renderer_process_gone',
  'renderer_unresponsive'
] as const

export type MigrationDiagnosticNativeFailureCode = (typeof MIGRATION_DIAGNOSTIC_NATIVE_FAILURE_CODES)[number]

export type MigrationDiagnosticNativeSaveResult =
  | { readonly status: 'saved' }
  | {
      readonly status: 'failed'
      readonly code: 'dialog_failed' | 'snapshot_failed' | 'bundle_save_failed' | 'save_in_progress'
    }

export type MigrationDiagnosticNativeDecision = 'retry' | 'use_default' | 'exit'

type SaveBundle = (destination: string) => Promise<MigrationDiagnosticNativeSaveResult>
type SaveInProgressResult = Extract<MigrationDiagnosticSaveResult, { status: 'failed' }> & { code: 'save_in_progress' }

type MigrationDiagnosticSaveTransaction = <T>(operation: () => Promise<T>) => Promise<T | SaveInProgressResult>

export interface MigrationDiagnosticFailureDialogState {
  readonly locale: string
  readonly code: MigrationDiagnosticNativeFailureCode
  readonly allowUseDefault?: boolean
  readonly saveBundle: SaveBundle
  readonly runSaveTransaction: MigrationDiagnosticSaveTransaction
}

export interface MigrationDiagnosticRecoveryDialogState {
  readonly locale: string
  readonly saveBundle: SaveBundle
}

type DecisionWithoutSave = MigrationDiagnosticNativeDecision

const FAILURE_MESSAGE_KEYS: Record<MigrationDiagnosticNativeFailureCode, string> = {
  path_resolution_failed: 'failure.path_resolution_failed',
  legacy_data_location_unavailable: 'failure.legacy_data_location_unavailable',
  data_location_pin_failed: 'failure.data_location_pin_failed',
  diagnostics_journal_failed: 'failure.diagnostics_journal_failed',
  database_initialize_failed: 'failure.database_initialize_failed',
  migration_status_probe_failed: 'failure.migration_status_probe_failed',
  version_check_failed: 'failure.version_check_failed',
  version_window_failed: 'failure.version_window_failed',
  migration_window_failed: 'failure.migration_window_failed',
  renderer_process_gone: 'failure.renderer_process_gone',
  renderer_unresponsive: 'failure.renderer_unresponsive'
}

const SAVE_FAILURE_PUBLIC_CODES: Record<
  Extract<MigrationDiagnosticNativeSaveResult, { status: 'failed' }>['code'],
  string
> = {
  dialog_failed: 'MIGRATION-DIAGNOSTIC-DIALOG-FAILED',
  snapshot_failed: 'MIGRATION-DIAGNOSTIC-SNAPSHOT-FAILED',
  bundle_save_failed: 'MIGRATION-DIAGNOSTIC-BUNDLE-SAVE-FAILED',
  save_in_progress: 'MIGRATION-DIAGNOSTIC-SAVE-IN-PROGRESS'
}

interface DecisionOption {
  readonly label: string
  readonly decision: DecisionWithoutSave | 'save'
}

function failureOptions(
  i18n: MigrationDiagnosticNativeI18n,
  state: MigrationDiagnosticFailureDialogState,
  includeSave: boolean
): DecisionOption[] {
  return [
    ...(includeSave ? [{ label: i18n.t('action.save'), decision: 'save' as const }] : []),
    { label: i18n.t('action.retry'), decision: 'retry' },
    ...(state.allowUseDefault ? [{ label: i18n.t('action.useDefault'), decision: 'use_default' as const }] : []),
    { label: i18n.t('action.exit'), decision: 'exit' }
  ]
}

function recoveryOptions(i18n: MigrationDiagnosticNativeI18n, includeSave: boolean): DecisionOption[] {
  return [
    ...(includeSave ? [{ label: i18n.t('action.savePrevious'), decision: 'save' as const }] : []),
    { label: i18n.t('action.retryMigration'), decision: 'retry' },
    { label: i18n.t('action.exit'), decision: 'exit' }
  ]
}

async function selectDestination(i18n: MigrationDiagnosticNativeI18n): Promise<string | null | 'dialog_failed'> {
  try {
    const result = await dialog.showSaveDialog({
      title: i18n.t('save.title'),
      defaultPath: 'cherry-studio-migration-diagnostics.zip',
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  } catch {
    return 'dialog_failed'
  }
}

export interface MigrationDiagnosticBundleDialogOutcome {
  result: MigrationDiagnosticSaveResult
  destination?: string
}

async function saveBundleWithDialog(
  i18n: MigrationDiagnosticNativeI18n,
  operation: SaveBundle
): Promise<MigrationDiagnosticBundleDialogOutcome> {
  const destination = await selectDestination(i18n)
  if (destination === null) return { result: { status: 'canceled' } }
  if (destination === 'dialog_failed') return { result: { status: 'failed', code: 'dialog_failed' } }

  try {
    const result = await operation(destination)
    if (result.status === 'saved') {
      return { result: { status: 'saved' }, destination }
    }
    return {
      result:
        SAVE_FAILURE_PUBLIC_CODES[result.code] === undefined ? { status: 'failed', code: 'snapshot_failed' } : result
    }
  } catch {
    return { result: { status: 'failed', code: 'snapshot_failed' } }
  }
}

export async function saveMigrationDiagnosticBundleWithDialog(
  locale: string,
  operation: SaveBundle
): Promise<MigrationDiagnosticBundleDialogOutcome> {
  return saveBundleWithDialog(await createMigrationDiagnosticNativeI18n(locale), operation)
}

async function saveBundle(
  i18n: MigrationDiagnosticNativeI18n,
  operation: SaveBundle
): Promise<'canceled' | MigrationDiagnosticNativeSaveResult> {
  const { result } = await saveBundleWithDialog(i18n, operation)
  if (result.status === 'canceled') return 'canceled'
  if (result.status === 'saved') return { status: 'saved' }
  return result
}

async function presentSaveOutcome(
  i18n: MigrationDiagnosticNativeI18n,
  result: MigrationDiagnosticNativeSaveResult,
  options: readonly DecisionOption[]
): Promise<DecisionWithoutSave> {
  const saved = result.status === 'saved'
  let response: Awaited<ReturnType<typeof dialog.showMessageBox>>
  try {
    response = await dialog.showMessageBox({
      type: saved ? 'info' : 'error',
      title: i18n.t(saved ? 'save.savedTitle' : 'save.failedTitle'),
      message: i18n.t(saved ? 'save.savedMessage' : 'save.failedMessage'),
      ...(saved ? {} : { detail: i18n.t('failure.code', { code: SAVE_FAILURE_PUBLIC_CODES[result.code] }) }),
      buttons: options.map((option) => option.label),
      defaultId: 0,
      cancelId: options.length - 1
    })
  } catch {
    return 'exit'
  }
  const selected = options[response.response]?.decision
  return selected === 'retry' || selected === 'use_default' ? selected : 'exit'
}

export async function presentMigrationDiagnosticFailure(
  state: MigrationDiagnosticFailureDialogState
): Promise<MigrationDiagnosticNativeDecision> {
  const i18n = await createMigrationDiagnosticNativeI18n(state.locale)
  const decisionOptions = failureOptions(i18n, state, true)
  while (true) {
    let response: Awaited<ReturnType<typeof dialog.showMessageBox>>
    try {
      response = await dialog.showMessageBox({
        type: 'error',
        title: i18n.t('failure.title'),
        message: i18n.t(FAILURE_MESSAGE_KEYS[state.code]),
        buttons: decisionOptions.map((option) => option.label),
        defaultId: 0,
        cancelId: decisionOptions.length - 1
      })
    } catch {
      return 'exit'
    }
    const selected = decisionOptions[response.response]?.decision ?? 'exit'
    if (selected !== 'save') return selected

    const saved = await state.runSaveTransaction(() => saveBundle(i18n, state.saveBundle))
    if (saved === 'canceled') continue
    return presentSaveOutcome(i18n, saved, failureOptions(i18n, state, false))
  }
}

export async function presentMigrationDiagnosticRecovery(
  state: MigrationDiagnosticRecoveryDialogState
): Promise<'retry' | 'exit'> {
  const i18n = await createMigrationDiagnosticNativeI18n(state.locale)
  const decisionOptions = recoveryOptions(i18n, true)
  while (true) {
    let response: Awaited<ReturnType<typeof dialog.showMessageBox>>
    try {
      response = await dialog.showMessageBox({
        type: 'warning',
        title: i18n.t('recovery.title'),
        message: i18n.t('recovery.message'),
        buttons: decisionOptions.map((option) => option.label),
        defaultId: 1,
        cancelId: decisionOptions.length - 1
      })
    } catch {
      return 'exit'
    }
    const selected = decisionOptions[response.response]?.decision ?? 'exit'
    if (selected !== 'save') return selected === 'retry' ? 'retry' : 'exit'

    const saved = await saveBundle(i18n, state.saveBundle)
    if (saved === 'canceled') continue
    const outcome = await presentSaveOutcome(i18n, saved, recoveryOptions(i18n, false))
    return outcome === 'retry' ? 'retry' : 'exit'
  }
}
