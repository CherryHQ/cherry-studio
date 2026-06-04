import { Button } from '@cherrystudio/ui'
import { useAttachment } from '@renderer/hooks/useAttachment'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types/file'
import { formatFileSize, parseFileTypes } from '@renderer/utils'
import { t } from 'i18next'
import { Paperclip } from 'lucide-react'
import type { FC } from 'react'

interface Props {
  file: FileMetadata
}

const MessageAttachments: FC<Props> = ({ file }) => {
  const { preview } = useAttachment()

  if (!file) {
    return null
  }

  const safePath = FileManager.getSafePath(file)
  const fileName = FileManager.formatFileName(file)
  const fileSuffix = file.ext ? file.ext.replace('.', '').toUpperCase() : file.type.toUpperCase()

  const handlePreview = () => {
    const fileType = parseFileTypes(file.type)
    if (fileType === null) {
      window.modal.error({ content: t('files.preview.error'), centered: true })
      return
    }
    void preview(safePath, fileName, fileType, file.ext)
  }

  return (
    <div className="message-attachments mt-0.5 mb-2">
      <div className="flex max-w-[520px] items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-background-soft) px-3 py-2">
        <div className="shrink-0 text-(--color-text-2)">
          <Paperclip size={16} />
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={handlePreview}
          title={fileName}
          aria-label={fileName}>
          <div className="truncate text-(--color-text-1) text-sm">{fileName}</div>
          <div className="text-(--color-text-2) text-xs">
            {formatFileSize(file.size)} · {fileSuffix}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handlePreview}>
            {t('common.preview')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.api.file.openPath(safePath)}>
            {t('files.open')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default MessageAttachments
