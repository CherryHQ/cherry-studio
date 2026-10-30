import type { TFunction } from 'i18next'

import { formatFileSize } from '@renderer/utils/file'

export function NotesDirectoryMigrationConfirmContent(props: {
  t: TFunction
  sourcePath: string
  targetPath: string
  markdownFileCount: number
  folderCount: number
  totalBytes: number
}) {
  const { t, sourcePath, targetPath, markdownFileCount, folderCount, totalBytes } = props
  const summary = t('settings.data.notes_relocation.confirm.summary', {
    notes: markdownFileCount,
    folders: folderCount,
    size: formatFileSize(totalBytes)
  })

  return (
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
  )
}

export function NotesDirectoryMigrationMergeContent(props: { t: TFunction; markdownFileCount: number }) {
  const { t, markdownFileCount } = props
  const mergeMessage =
    markdownFileCount > 0
      ? t('settings.data.notes_relocation.merge.content', { count: markdownFileCount })
      : t('settings.data.notes_relocation.merge.content_other_files')

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{mergeMessage}</p>
      <p className="text-foreground-tertiary">{t('settings.data.notes_relocation.merge.choose_another_hint')}</p>
    </div>
  )
}
