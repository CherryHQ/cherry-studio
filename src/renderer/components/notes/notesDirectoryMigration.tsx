import type { TFunction } from 'i18next'

import { loggerService } from '@logger'
import {
  NotesDirectoryMigrationConfirmContent,
  NotesDirectoryMigrationMergeContent
} from '@renderer/components/notes/NotesDirectoryMigrationConfirmContent'
import { ipcApi } from '@renderer/ipc'
import { resolveNotesPath } from '@renderer/services/NotesService'
import { normalizePathValue } from '@renderer/services/NotesTreeService'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'
import type { NotesRelocationValidationReason } from '@shared/types/notesRelocation'

const logger = loggerService.withContext('NotesDirectoryMigration')

export async function resolveNotesMigrationSourcePath(configuredNotesPath: string): Promise<string> {
  const resolved = await resolveNotesPath(configuredNotesPath || '')
  return resolved.isFallback && configuredNotesPath ? configuredNotesPath : resolved.path
}

async function finishNotesRelocationSession(sessionEpoch: number): Promise<void> {
  try {
    await ipcApi.request('app.notes_relocation.complete', { sessionEpoch })
    return
  } catch (firstError) {
    logger.error('Failed to complete notes relocation session', firstError as Error)
  }

  try {
    await ipcApi.request('app.notes_relocation.complete', { sessionEpoch })
    return
  } catch (retryError) {
    logger.error('Failed to complete notes relocation session after retry', retryError as Error)
  }

  try {
    await ipcApi.request('app.notes_relocation.release_session', { sessionEpoch })
  } catch (releaseError) {
    logger.error('Failed to release notes relocation session', releaseError as Error)
  }
}

function showValidationError(t: TFunction, reason: NotesRelocationValidationReason) {
  const key = `settings.data.notes_relocation.error.${reason}` as const
  toast.error(t(key, { defaultValue: t('settings.data.notes_relocation.error.generic') }))
}

async function confirmMigration(
  t: TFunction,
  sourcePath: string,
  targetPath: string,
  markdownFileCount: number,
  folderCount: number,
  totalBytes: number
): Promise<boolean> {
  return popup.confirm({
    title: t('settings.data.notes_relocation.confirm.title'),
    width: 'min(560px, 90vw)',
    content: (
      <NotesDirectoryMigrationConfirmContent
        t={t}
        sourcePath={sourcePath}
        targetPath={targetPath}
        markdownFileCount={markdownFileCount}
        folderCount={folderCount}
        totalBytes={totalBytes}
      />
    ),
    okText: t('settings.data.notes_relocation.confirm.action'),
    cancelText: t('common.cancel'),
    centered: true
  })
}

async function confirmMerge(t: TFunction, markdownFileCount: number): Promise<boolean> {
  return popup.confirm({
    title: t('settings.data.notes_relocation.merge.title'),
    content: <NotesDirectoryMigrationMergeContent t={t} markdownFileCount={markdownFileCount} />,
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
    if (inspection.targetHasFiles || inspection.target.folderCount > 0) {
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
      inspection.source.markdownFileCount,
      inspection.source.folderCount,
      inspection.source.totalBytes
    )
    if (!confirmed) {
      return
    }

    const { sessionEpoch } = await ipcApi.request('app.notes_relocation.begin_barrier')
    try {
      const { sourcePath: authoritativeSourcePath } = await ipcApi.request(
        'app.notes_relocation.resolve_migration_source'
      )
      if (normalizePathValue(authoritativeSourcePath) !== normalizePathValue(sourcePath)) {
        toast.error(t('settings.data.notes_relocation.error.source_changed'))
        return
      }

      await ipcApi.request('app.notes_relocation.migrate', {
        sourcePath,
        targetPath,
        merge,
        sessionEpoch
      })

      try {
        await onSuccess(targetPath)
      } catch (error) {
        logger.error('Notes migrated but notes path preference update failed', error as Error)
        toast.error(t('settings.data.notes_relocation.error.preference_update_failed'))
        return
      }

      toast.success(t('settings.data.notes_relocation.success'))
    } finally {
      await finishNotesRelocationSession(sessionEpoch)
    }
  } catch (error) {
    logger.error('Notes directory migration failed', error as Error)
    if (error instanceof IpcError && error.code === notesRelocationErrorCodes.NOTES_RELOCATION_FLUSH_FAILED) {
      toast.error(t('settings.data.notes_relocation.error.flush_failed'))
      return
    }
    if (error instanceof IpcError && error.code === notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS) {
      toast.error(t('settings.data.notes_relocation.error.in_progress'))
      return
    }
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
  try {
    const targetPath = await pickNotesTargetDirectory(options.t)
    if (!targetPath) {
      return
    }
    await migrateNotesDirectoryWithUi({ ...options, targetPath })
  } catch (error) {
    logger.error('Failed to start notes directory migration', error as Error)
    toast.error(options.t('settings.data.notes_relocation.error.generic'))
  }
}
