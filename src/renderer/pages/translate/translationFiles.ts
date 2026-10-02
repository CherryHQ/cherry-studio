import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import { type FileEntryId, translateHistorySourceType } from '@shared/data/types/file'
import type { TranslateHistory } from '@shared/data/types/translate'
import type { AbsoluteFilePath } from '@shared/types/file'

/** A file a `kind='file'` history row points at. `path` is `null` once the entry is gone. */
export interface TranslationFile {
  entryId: FileEntryId
  path: AbsoluteFilePath | null
}

export interface TranslationFiles {
  /** The user's original. Absent when referencing it failed at translation time. */
  source: TranslationFile | null
  /** The generated file. Absent only if its entry was deleted out from under the row. */
  target: TranslationFile | null
}

/**
 * Resolve a `kind='file'` history row into the two files it owns.
 *
 * Fetched on demand rather than carried on `TranslateHistory`: the entry ids matter
 * only when the user opens one row, and a physical path is filesystem state that
 * would go stale the moment a list response cached it.
 */
export async function loadTranslationFiles(historyId: string): Promise<TranslationFiles> {
  const refs = await dataApiService.get('/files/refs', {
    query: { sourceType: translateHistorySourceType, sourceId: historyId }
  })
  // The database enforces one entry per role; Map provides direct role lookup here.
  const byRole = new Map(
    refs.flatMap((ref) => (ref.sourceType === translateHistorySourceType ? [[ref.role, ref.fileEntryId] as const] : []))
  )
  const ids = [...byRole.values()]
  if (ids.length === 0) return { source: null, target: null }

  const paths = await ipcApi.request('file.batch_get_physical_paths', { ids })
  const toFile = (entryId: FileEntryId | undefined): TranslationFile | null =>
    entryId ? { entryId, path: paths[entryId] ?? null } : null

  return { source: toFile(byRole.get('source')), target: toFile(byRole.get('target')) }
}

/**
 * Whether a file translation can be reopened in the Translate page's side-by-side
 * view, which renders both files through the PDF preview.
 *
 * This — not `kind` — is where format lives. `kind='file'` only says the row's
 * content is a pair of files; a future non-PDF translation flow writes those rows
 * too but has no viewer here. The names are display labels snapshotted at
 * translation time, which is the right basis: they describe what was produced, and
 * renaming an entry later must not retroactively change whether a row is previewable.
 */
export function isPdfTranslation(history: TranslateHistory): boolean {
  const isPdfName = (name: string) => name.toLowerCase().endsWith('.pdf')
  return history.kind === 'file' && isPdfName(history.sourceText) && isPdfName(history.targetText)
}

/** Copy a translated file to a user-chosen location via the save dialog. */
export async function saveTranslationFileAs(path: AbsoluteFilePath, fileName: string): Promise<void> {
  const content = await window.api.fs.read(path)
  const ext = fileName.split('.').pop()
  const filters = ext && ext !== fileName ? [{ name: ext.toUpperCase(), extensions: [ext] }] : []
  await window.api.file.save(fileName, content, { filters })
}
