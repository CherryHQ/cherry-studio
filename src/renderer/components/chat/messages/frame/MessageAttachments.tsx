import { Paperclip } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, CircularProgress } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { popup } from '@renderer/services/popup'
import { formatFileSize } from '@renderer/utils/file'
import type { FileHandle } from '@shared/data/types/file'
import { isFileEntryHandle } from '@shared/utils/file'

import { useOptionalMessageListActions, useOptionalMessageListUi } from '../MessageListProvider'

interface Props {
  /** Addresses the file for open / preview. Main resolves it; never a path this component built. */
  handle?: FileHandle
  name: string
  ext: string
  createdAt?: string
  size?: number
  transfer?: { state: 'uploading' | 'ready' | 'error'; percent: number }
}

const MessageAttachments: FC<Props> = ({ handle, name, ext, createdAt, size: pendingSize, transfer }) => {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const messageUi = useOptionalMessageListUi()
  const entryId = handle && isFileEntryHandle(handle) ? handle.entryId : undefined
  // The part carries no size; the entry row is the authoritative one for managed files.
  const { data: entry } = useQuery('/files/entries/:id', {
    params: { id: entryId ?? '' },
    enabled: !!entryId
  })

  const displayExt = entry?.ext || ext
  const fileView = messageUi?.getFileView?.({
    origin_name: entry?.name || name,
    ext: displayExt,
    created_at: createdAt ?? ''
  })
  const fileName = fileView?.displayName || entry?.name || name
  const fileSuffix = displayExt.replace('.', '').toUpperCase()
  const size = entry?.origin === 'internal' ? entry.size : pendingSize
  const openFile = handle ? actions?.openFile : undefined
  const previewFile = handle ? actions?.previewFile : undefined
  const target = handle ? { handle, name: fileName, ext: displayExt } : undefined

  const handleOpen = () => {
    if (!openFile || !target) return
    void Promise.resolve(openFile(target)).catch(() => {
      void popup.error({ content: t('files.preview.error'), centered: true })
    })
  }

  const handlePreview = () => {
    if (target) void previewFile?.(target)
  }

  return (
    <div className="message-attachments mt-0.5 mb-2 max-w-full" aria-busy={transfer?.state === 'uploading'}>
      <div className="flex max-w-130 items-center gap-3 rounded-lg border border-border bg-muted px-3 py-2">
        <div className="shrink-0 text-muted-foreground">
          <Paperclip size={16} />
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={previewFile ? handlePreview : undefined}
          title={fileName}
          aria-label={fileName}
          disabled={!previewFile}>
          <div className="truncate text-foreground text-sm">{fileName}</div>
          <div className="text-muted-foreground text-xs">
            {size !== undefined ? `${formatFileSize(size)} · ${fileSuffix}` : fileSuffix}
          </div>
        </button>
        {transfer ? (
          <div className="flex shrink-0 items-center gap-2" role="status">
            <span className="text-muted-foreground text-xs">
              {transfer.state === 'ready'
                ? t('knowledge.data_source.status.ready')
                : transfer.state === 'error'
                  ? t('common.error')
                  : t('message.tools.activity.uploading')}
            </span>
            {transfer.state === 'uploading' && (
              <CircularProgress value={transfer.percent} size={30} strokeWidth={2} showLabel />
            )}
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" disabled={!previewFile} onClick={handlePreview}>
              {t('common.preview')}
            </Button>
            <Button size="sm" variant="outline" disabled={!openFile} onClick={handleOpen}>
              {t('files.open')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default MessageAttachments
