import { app, clipboard, dialog, shell } from 'electron'

import { resolveSystemLanguage, t } from '@main/i18n'
import type { MigrationStage } from '@shared/data/migration/v2/types'

export const OFFICIAL_RELEASES_URL = 'https://github.com/CherryHQ/cherry-studio/releases'
const FEEDBACK_URL = 'mailto:support@cherry-ai.com?subject=Cherry%20Studio%20Feedback'

type SupportKind = 'copy' | 'feedback' | 'releases' | 'migration-export'

interface SupportedDialogInput {
  readonly box: Electron.MessageBoxOptions
  /** Copied on request. Kept off the primary message so private paths stay out of it. */
  readonly technicalDetail?: string
  readonly migrationExport?: { readonly stage: MigrationStage; readonly logDate: string }
}

function supportActions(input: SupportedDialogInput, language: ReturnType<typeof resolveSystemLanguage>) {
  const actions: Array<{ kind: SupportKind; label: string }> = [
    { kind: 'copy', label: t('dialog.support.copy', undefined, language) },
    { kind: 'feedback', label: t('dialog.support.feedback', undefined, language) },
    { kind: 'releases', label: t('dialog.support.releases', undefined, language) }
  ]
  if (input.migrationExport) {
    actions.push({ kind: 'migration-export', label: t('dialog.support.migration_export', undefined, language) })
  }
  return actions
}

async function runSupport(
  kind: SupportKind,
  input: SupportedDialogInput,
  language: ReturnType<typeof resolveSystemLanguage>
): Promise<void> {
  if (kind === 'copy') {
    await clipboard.writeText(input.technicalDetail ?? input.box.message)
    return
  }
  if (kind === 'feedback') {
    await shell.openExternal(FEEDBACK_URL)
    return
  }
  if (kind === 'releases') {
    await shell.openExternal(OFFICIAL_RELEASES_URL)
    return
  }
  const exportInput = input.migrationExport
  if (!exportInput) throw new Error(t('dialog.support.diagnostics_unavailable', undefined, language))
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: t('dialog.support.migration_export', undefined, language),
    defaultPath: 'cherry-studio-migration-diagnostics.zip'
  })
  if (canceled || !filePath) return
  const { saveMigrationDiagnosticBundle } = await import('@data/migration/v2')
  const saved = await saveMigrationDiagnosticBundle({
    destination: filePath,
    stage: exportInput.stage,
    logDate: exportInput.logDate
  })
  if (saved === false) throw new Error(t('dialog.support.archive_write_failed', undefined, language))
}

function failureLine(error: unknown, language: ReturnType<typeof resolveSystemLanguage>): string {
  const message = error instanceof Error ? error.message : String(error)
  return t('dialog.support.failed', { message }, language)
}

function cancelIndex(cancelId: number | undefined, primaryLength: number): number {
  if (typeof cancelId === 'number' && cancelId >= 0 && cancelId < primaryLength) return cancelId
  return 0
}

/**
 * Show the original dialog, then Copy / Feedback / Releases (and migration export
 * when that bundle can be written). Support choices loop back to the same dialog.
 * The returned index is always one of the original buttons. A response outside
 * that set returns the original cancel button and does not ask again.
 * Analysis is unavailable on this path; the detail says so. Technical text is
 * copied on request and is not placed on the dialog options.
 */
export async function showSupportedMessageBox(input: SupportedDialogInput): Promise<number> {
  if (typeof app.isReady === 'function' && !app.isReady()) await app.whenReady()
  const language = resolveSystemLanguage(app.getLocale())
  const primary = input.box.buttons ?? [t('dialog.support.ok', undefined, language)]
  const support = supportActions(input, language)
  const cancelId = cancelIndex(input.box.cancelId, primary.length)
  const analysis = t('dialog.support.analysis_unavailable', undefined, language)
  let failure = ''
  for (;;) {
    const baseDetail = [input.box.detail, analysis].filter(Boolean).join('\n\n')
    const result = await dialog.showMessageBox({
      ...input.box,
      buttons: [...primary, ...support.map((item) => item.label)],
      detail: failure ? [baseDetail, failure].filter(Boolean).join('\n\n') : baseDetail
    })
    const response = result?.response
    const supportIndex = typeof response === 'number' ? response - primary.length : -1
    const action = supportIndex >= 0 ? support[supportIndex] : undefined
    if (!action) return typeof response === 'number' && response >= 0 && response < primary.length ? response : cancelId
    try {
      await runSupport(action.kind, input, language)
      failure = ''
    } catch (error) {
      failure = failureLine(error, language)
    }
  }
}
