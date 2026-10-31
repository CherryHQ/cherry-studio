import { Icon } from '@iconify/react'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, CircularProgress } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useQuery } from '@data/hooks/useDataApi'
import { popup } from '@renderer/services/popup'
import type { InputFilePreview } from '@renderer/types/inputFilePreview'
import { getFileIconName } from '@renderer/utils/fileIconName'
import type { FileHandle } from '@shared/data/types/file'
import { isFileEntryHandle } from '@shared/utils/file'

import { useOptionalMessageListActions, useOptionalMessageListUi } from '../MessageListProvider'

interface Props {
  /** Addresses the file for open / preview. Main resolves it; never a path this component built. */
  handle?: FileHandle
  inputFilePreview?: InputFilePreview
  name: string
  ext: string
  createdAt?: string
  transfer?: { state: 'uploading' | 'ready' | 'error'; percent: number }
}

const MessageAttachments: FC<Props> = ({ handle, inputFilePreview, name, ext, createdAt, transfer }) => {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const messageUi = useOptionalMessageListUi()
  const entryId = handle && isFileEntryHandle(handle) ? handle.entryId : undefined
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
  const sourceName = entry?.name || name
  const iconFileName =
    fileSuffix && !sourceName.toLowerCase().endsWith(`.${fileSuffix.toLowerCase()}`)
      ? `${sourceName}.${fileSuffix}`
      : sourceName
  const openFile = handle ? actions?.openFile : undefined
  const previewFile = handle ? actions?.previewFile : undefined
  const previewInputFile = inputFilePreview ? actions?.previewInputFile : undefined
  const canPreview = !!(previewInputFile || previewFile)
  const target = handle ? { handle, name: fileName, ext: displayExt } : undefined

  const handleOpen = () => {
    if (!openFile || !target) return
    void Promise.resolve(openFile(target)).catch(() => {
      void popup.error({ content: t('files.preview.error'), centered: true })
    })
  }

  const handlePreview = () => {
    if (previewInputFile && inputFilePreview) {
      void previewInputFile({ ...inputFilePreview, displayName: fileName })
    } else if (target) {
      void previewFile?.(target)
    }
  }

  return (
    <div className="message-attachments mt-0.5 mb-2 max-w-full" aria-busy={transfer?.state === 'uploading'}>
      <div
        className={cn(
          'flex w-72 max-w-full items-center rounded-2xl bg-muted',
          (canPreview || openFile) && 'hover:bg-secondary-hover/70 focus-within:bg-secondary-hover/70'
        )}>
        <Button
          type="button"
          variant="ghost"
          className="group/preview h-auto min-w-0 flex-1 shrink gap-3 rounded-2xl p-3 text-left transition-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-100"
          onClick={canPreview ? handlePreview : handleOpen}
          title={fileName}
          aria-label={fileName}
          disabled={!canPreview && !openFile}>
          <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden="true">
            <Icon icon={`material-icon-theme:${getFileIconName(iconFileName)}`} className="size-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground text-sm font-normal">{fileName}</span>
            <span aria-hidden className="mt-0.5 grid min-w-0 text-muted-foreground text-xs">
              <span
                className={cn(
                  'col-start-1 row-start-1 truncate',
                  canPreview && 'group-hover/preview:invisible group-focus-visible/preview:invisible'
                )}>
                {fileSuffix || t('chat.input.tools.file_type.file')}
              </span>
              {canPreview && (
                <span className="invisible col-start-1 row-start-1 truncate group-hover/preview:visible group-focus-visible/preview:visible">
                  {`${t('common.preview')} ${fileSuffix || t('chat.input.tools.file_type.file')}`}
                </span>
              )}
            </span>
          </span>
        </Button>
        {transfer ? (
          <div className="flex shrink-0 items-center gap-2 pr-3" role="status">
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
        ) : openFile && canPreview ? (
          <Button
            size="icon-sm"
            variant="ghost"
            className="mr-3 transition-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            title={t('files.open')}
            aria-label={t('files.open')}
            onClick={handleOpen}>
            <ExternalLink className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export default MessageAttachments
