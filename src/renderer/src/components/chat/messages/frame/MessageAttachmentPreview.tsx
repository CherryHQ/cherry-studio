import { ColFlex, Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import ImageViewer from '@renderer/components/ImageViewer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useAttachment } from '@renderer/hooks/useAttachment'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import type { CherryMessagePart } from '@shared/data/types/message'
import {
  FileArchive,
  FileBadge,
  FileImage,
  FileQuestionMark,
  FileSpreadsheet,
  FileText,
  FileType,
  FolderOpen,
  Globe,
  Link,
  type LucideIcon,
  Paperclip,
  Presentation
} from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const MAX_FILENAME_DISPLAY_LENGTH = 20
const FILE_ICON_SIZE = 12

const fileIcon = (Icon: LucideIcon) => <Icon size={FILE_ICON_SIZE} />

function truncateFileName(name: string, maxLength: number = MAX_FILENAME_DISPLAY_LENGTH) {
  if (name.length <= maxLength) return name
  return `${name.slice(0, maxLength - 3)}...`
}

const getFileIcon = (type?: string) => {
  if (!type) return fileIcon(FileQuestionMark)

  const ext = type.toLowerCase()

  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
    return fileIcon(FileImage)
  }

  if (['.doc', '.docx'].includes(ext)) {
    return fileIcon(FileBadge)
  }
  if (['.xls', '.xlsx'].includes(ext)) {
    return fileIcon(FileSpreadsheet)
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return fileIcon(Presentation)
  }
  if (ext === '.pdf') {
    return fileIcon(FileType)
  }
  if (['.md', '.markdown'].includes(ext)) {
    return fileIcon(FileText)
  }

  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return fileIcon(FileArchive)
  }

  if (['.txt', '.json', '.log', '.yml', '.yaml', '.xml', '.csv', '.tscn', '.gd'].includes(ext)) {
    return fileIcon(FileText)
  }

  if (ext === '.url') {
    return fileIcon(Link)
  }

  if (ext === '.sitemap') {
    return fileIcon(Globe)
  }

  if (ext === '.folder') {
    return fileIcon(FolderOpen)
  }

  return fileIcon(FileQuestionMark)
}

const getFilenameExtension = (filename?: string) => {
  const ext = filename?.split('.').pop()
  return ext ? `.${ext}` : undefined
}

const FileNameRender: FC<{ file: FileMetadata }> = ({ file }) => {
  const { preview } = useAttachment()
  const [visible, setVisible] = useState(false)

  const isImage = (ext: string) => ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext.toLowerCase())
  const fullName = FileManager.formatFileName(file)
  const displayName = truncateFileName(fullName)

  return (
    <Tooltip
      classNames={{ content: 'p-1' }}
      content={
        <ColFlex className="items-center gap-0.5">
          {isImage(file.ext) && (
            <ImageViewer
              className="max-h-[200px] w-20"
              src={`file://${FileManager.getSafePath(file)}`}
              preview={{
                visible,
                src: `file://${FileManager.getSafePath(file)}`,
                onVisibleChange: setVisible
              }}
            />
          )}
          <span className="break-all">{fullName}</span>
          {formatFileSize(file.size)}
        </ColFlex>
      }>
      <span
        className="cursor-pointer hover:underline"
        onClick={() => {
          if (isImage(file.ext)) {
            setVisible(true)
            return
          }
          const path = FileManager.getSafePath(file)
          const name = FileManager.formatFileName(file)
          void preview(path, name, file.type, file.ext)
        }}
        title={fullName}>
        {displayName}
      </span>
    </Tooltip>
  )
}

export const MessageAttachmentButton: FC<{
  active: boolean
  couldAddImageFile: boolean
  disabled?: boolean
  onClick: () => void
}> = ({ active, couldAddImageFile, disabled, onClick }) => {
  const { t } = useTranslation()
  const ariaLabel = couldAddImageFile ? t('chat.input.upload.image_or_document') : t('chat.input.upload.document')

  return (
    <Tooltip placement="top" content={ariaLabel}>
      <ActionIconButton
        onClick={onClick}
        active={active}
        disabled={disabled}
        aria-label={ariaLabel}
        icon={<Paperclip size={18} />}
      />
    </Tooltip>
  )
}

export const MessageAttachmentPreview: FC<{
  parts: CherryMessagePart[]
  files: FileMetadata[]
  onRemovePart: (index: number) => void
  onRemoveFile: (fileId: string) => void
}> = ({ parts, files, onRemovePart, onRemoveFile }) => {
  const fileParts = parts.map((part, index) => ({ part, index })).filter(({ part }) => part.type === 'file')

  if (fileParts.length === 0 && files.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2 border-border/70 border-t px-3 py-2">
      {fileParts.map(({ part, index }) => {
        const filePart = part as { filename?: string; url?: string }
        return (
          <CustomTag
            key={`file-part-${index}`}
            icon={getFileIcon(getFilenameExtension(filePart.filename))}
            color="#37a5aa"
            closable
            onClose={() => onRemovePart(index)}>
            {filePart.filename || filePart.url || 'file'}
          </CustomTag>
        )
      })}

      {files.map((file) => (
        <CustomTag
          key={file.id}
          icon={getFileIcon(file.ext)}
          color="#37a5aa"
          closable
          onClose={() => onRemoveFile(file.id)}>
          <FileNameRender file={file} />
        </CustomTag>
      ))}
    </div>
  )
}
