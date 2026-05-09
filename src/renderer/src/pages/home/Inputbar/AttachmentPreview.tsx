import { ColFlex, Tooltip } from '@cherrystudio/ui'
import ConfirmDialog from '@renderer/components/ConfirmDialog'
import ImageViewer from '@renderer/components/ImageViewer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useAttachment } from '@renderer/hooks/useAttachment'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { isEmpty } from 'lodash'
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
  Presentation
} from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  files: FileMetadata[]
  setFiles: (files: FileMetadata[]) => void
  onAttachmentContextMenu?: (file: FileMetadata, event: MouseEvent<HTMLDivElement>) => void
}

const MAX_FILENAME_DISPLAY_LENGTH = 20
const FILE_ICON_SIZE = 12

const fileIcon = (Icon: LucideIcon) => <Icon size={FILE_ICON_SIZE} />

function truncateFileName(name: string, maxLength: number = MAX_FILENAME_DISPLAY_LENGTH) {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength - 3) + '...'
}

export const getFileIcon = (type?: string) => {
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

  if (['.url'].includes(ext)) {
    return fileIcon(Link)
  }

  if (['.sitemap'].includes(ext)) {
    return fileIcon(Globe)
  }

  if (['.folder'].includes(ext)) {
    return fileIcon(FolderOpen)
  }

  return fileIcon(FileQuestionMark)
}

export const FileNameRender: FC<{ file: FileMetadata }> = ({ file }) => {
  const { preview } = useAttachment()
  const [visible, setVisible] = useState<boolean>(false)
  const isImage = (ext: string) => {
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext.toLocaleLowerCase())
  }

  const fullName = FileManager.formatFileName(file)
  const displayName = truncateFileName(fullName)

  return (
    <Tooltip
      classNames={{
        content: 'p-1'
      }}
      content={
        <ColFlex className="items-center gap-0.5">
          {isImage(file.ext) && (
            <ImageViewer
              className="max-h-[200px] w-20"
              src={'file://' + FileManager.getSafePath(file)}
              preview={{
                visible: visible,
                src: 'file://' + FileManager.getSafePath(file),
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

const AttachmentPreview: FC<Props> = ({ files, setFiles, onAttachmentContextMenu }) => {
  const { t } = useTranslation()
  const [contextMenu, setContextMenu] = useState<{
    file: FileMetadata
    x: number
    y: number
  } | null>(null)

  const handleContextMenu = async (file: FileMetadata, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    // 获取被点击元素的位置
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()

    // 计算对话框位置：附件标签的中心位置
    const x = rect.left + rect.width / 2
    const y = rect.top

    try {
      const isText = await window.api.file.isTextFile(file.path)
      if (!isText) {
        setContextMenu(null)
        return
      }

      setContextMenu({
        file,
        x,
        y
      })
    } catch (error) {
      setContextMenu(null)
    }
  }

  const handleConfirm = () => {
    if (contextMenu && onAttachmentContextMenu) {
      // Create a synthetic mouse event for the callback
      const syntheticEvent = {
        preventDefault: () => {},
        stopPropagation: () => {}
      } as MouseEvent<HTMLDivElement>
      onAttachmentContextMenu(contextMenu.file, syntheticEvent)
    }
    setContextMenu(null)
  }

  const handleCancel = () => {
    setContextMenu(null)
  }

  if (isEmpty(files)) {
    return null
  }

  return (
    <>
      <div className="flex w-full flex-wrap gap-1 px-[15px] py-[5px]">
        {files.map((file) => (
          <CustomTag
            key={file.id}
            icon={getFileIcon(file.ext)}
            color="#37a5aa"
            closable
            onClose={() => setFiles(files.filter((f) => f.id !== file.id))}
            onContextMenu={(event) => {
              void handleContextMenu(file, event)
            }}>
            <FileNameRender file={file} />
          </CustomTag>
        ))}
      </div>

      {contextMenu && (
        <ConfirmDialog
          x={contextMenu.x}
          y={contextMenu.y}
          message={t('chat.input.paste_text_file_confirm')}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  )
}

export default AttachmentPreview
