import { Button } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { popup } from '@renderer/services/popup'
import { formatFileSize } from '@renderer/utils/file'
import type { FileHandle } from '@shared/data/types/file'
import { isFileEntryHandle } from '@shared/utils/file'
import { Paperclip } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions, useOptionalMessageListUi } from '../MessageListProvider'

interface Props {
  /** Addresses the file for open / preview. Main resolves it; never a path this component built. */
  handle: FileHandle
  name: string
  ext: string
  createdAt: string
}

const MessageAttachments: FC<Props> = ({ handle, name, ext, createdAt }) => {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const messageUi = useOptionalMessageListUi()
  const entryId = isFileEntryHandle(handle) ? handle.entryId : undefined
  // The part carries no size; the entry row is the authoritative one for managed files.
  const { data: entry } = useQuery('/files/entries/:id', {
    params: { id: entryId ?? '' },
    enabled: !!entryId
  })

  const displayExt = entry?.ext || ext
  const fileView = messageUi?.getFileView?.({
    origin_name: entry?.name || name,
    ext: displayExt,
    created_at: createdAt
  })
  const fileName = fileView?.displayName || entry?.name || name
  const fileSuffix = displayExt.replace('.', '').toUpperCase()
  const size = entry?.origin === 'internal' ? entry.size : undefined
  const openFile = actions?.openFile
  const previewFile = actions?.previewFile
  const target = { handle, name: fileName, ext: displayExt }

  const handleOpen = () => {
    if (!openFile) return
    void Promise.resolve(openFile(target)).catch(() => {
      void popup.error({ content: t('files.preview.error'), centered: true })
    })
  }

  const handlePreview = () => {
    void previewFile?.(target)
  }

  return (
    <div className="message-attachments mt-0.5 mb-2">
      <div className="flex max-w-130 items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2">
        <div className="shrink-0 text-muted-foreground">
          <Paperclip size={16} />
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={previewFile ? handlePreview : undefined}
          title={fileName}
          aria-label={fileName}>
          <div className="truncate text-foreground text-sm">{fileName}</div>
          <div className="text-muted-foreground text-xs">
            {size ? `${formatFileSize(size)} · ${fileSuffix}` : fileSuffix}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!previewFile} onClick={handlePreview}>
            {t('common.preview')}
          </Button>
          <Button size="sm" variant="outline" disabled={!openFile} onClick={handleOpen}>
            {t('files.open')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default MessageAttachments
