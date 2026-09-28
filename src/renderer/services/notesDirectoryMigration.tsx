import type { TFunction } from 'i18next'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatFileSize } from '@renderer/utils/file'
import type { NotesRelocationValidationReason } from '@shared/types/notesRelocation'

const logger = loggerService.withContext('NotesDirectoryMigration')

function showValidationError(t: TFunction, reason: NotesRelocationValidationReason) {
  const key = `settings.data.notes_relocation.error.${reason}` as const
  toast.error(t(key, { defaultValue: t('settings.data.notes_relocation.error.generic') }))
}

function formatMigrationSummary(
  t: TFunction,
  markdownFileCount: number,
  folderCount: number,
  totalBytes: number
): string {
  return t('settings.data.notes_relocation.confirm.summary', {
    notes: markdownFileCount,
    folders: folderCount,
    size: formatFileSize(totalBytes)
  })
}

async function confirmMigration(
  t: TFunction,
  sourcePath: string,
  targetPath: string,
  summary: string
): Promise<boolean> {
  return popup.confirm({
    title: t('settings.data.notes_relocation.confirm.title'),
    width: 'min(560px, 90vw)',
    content: (
      <div className="flex flex-col gap-4 text-sm">
        <p>{summary}</p>
        <div>
          <div className="font-medium">{t('settings.data.notes_relocation.confirm.from')}</div>
          <div className="break-all rounded border border-border bg-background-subtle px-3 py-2 text-muted-foreground">
            {sourcePath}
          </div>
        </div>
        <div>
          <div className="font-medium">{t('settings.data.notes_relocation.confirm.to')}</div>
          <div className="break-all rounded border border-border bg-background-subtle px-3 py-2 text-muted-foreground">
            {targetPath}
          </div>
        </div>
        <p className="text-foreground-tertiary">{t('settings.data.notes_relocation.confirm.notice')}</p>
      </div>
    ),
    okText: t('settings.data.notes_relocation.confirm.action'),
    cancelText: t('common.cancel'),
    centered: true
  })
}

async function confirmMerge(t: TFunction, markdownFileCount: number): Promise<boolean> {
  return popup.confirm({
    title: t('settings.data.notes_relocation.merge.title'),
    content: (
      <div className="flex flex-col gap-2 text-sm">
        <p>{t('settings.data.notes_relocation.merge.content', { count: markdownFileCount })}</p>
        <p className="text-foreground-tertiary">{t('settings.data.notes_relocation.merge.choose_another_hint')}</p>
      </div>
    ),
    okText: t('settings.data.notes_relocation.merge.merge'),
    cancelText: t('common.cancel'),
    centered: true
  })
}

export async function migrateNotesDirectoryWithUi(options: {
  t: TFunction
  sourcePath: string
  targetPath: string
  onSuccess: (targetPath: string) => void | Promise<void>
}): Promise<void> {
  const { t, sourcePath, targetPath, onSuccess } = options

  try {
    const inspection = await ipcApi.request('app.notes_relocation.inspect', {
      sourcePath,
      targetPath
    })

    if (!inspection.valid) {
      showValidationError(t, inspection.reason)
      return
    }

    let merge = false
    if (inspection.targetHasMarkdown) {
      const mergeConfirmed = await confirmMerge(t, inspection.target.markdownFileCount)
      if (!mergeConfirmed) {
        return
      }
      merge = true
    }

    const confirmed = await confirmMigration(
      t,
      sourcePath,
      targetPath,
      formatMigrationSummary(
        t,
        inspection.source.markdownFileCount,
        inspection.source.folderCount,
        inspection.source.totalBytes
      )
    )
    if (!confirmed) {
      return
    }

    await ipcApi.request('app.notes_relocation.migrate', {
      sourcePath,
      targetPath,
      merge
    })
    await onSuccess(targetPath)
    toast.success(t('settings.data.notes_relocation.success'))
  } catch (error) {
    logger.error('Notes directory migration failed', error as Error)
    toast.error(t('settings.data.notes_relocation.error.generic'))
  }
}

export async function pickNotesTargetDirectory(t: TFunction): Promise<string> {
  const result = await window.api.file.selectFolder({
    title: t('settings.data.notes_relocation.select_title'),
    properties: ['openDirectory', 'createDirectory']
  })
  return result ?? ''
}

export async function startNotesDirectoryMigration(options: {
  t: TFunction
  sourcePath: string
  onSuccess: (targetPath: string) => void | Promise<void>
}): Promise<void> {
  const targetPath = await pickNotesTargetDirectory(options.t)
  if (!targetPath) {
    return
  }
  await migrateNotesDirectoryWithUi({ ...options, targetPath })
}
