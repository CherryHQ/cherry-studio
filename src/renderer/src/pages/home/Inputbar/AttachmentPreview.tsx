import {
  FileExcelFilled,
  FileImageFilled,
  FileMarkdownFilled,
  FilePdfFilled,
  FilePptFilled,
  FileTextFilled,
  FileUnknownFilled,
  FileWordFilled,
  FileZipFilled,
  FolderOpenFilled,
  GlobalOutlined,
  LinkOutlined
} from '@ant-design/icons'
import {
  ColFlex,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useAttachment } from '@renderer/hooks/useAttachment'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Image } from 'antd'
import { isEmpty } from 'lodash'
import type { FC } from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  files: FileMetadata[]
  setFiles: (files: FileMetadata[]) => void
  onPasteAsText?: (file: FileMetadata) => void
}

const MAX_FILENAME_DISPLAY_LENGTH = 20
function truncateFileName(name: string, maxLength: number = MAX_FILENAME_DISPLAY_LENGTH) {
  if (name.length <= maxLength) return name
  return name.slice(0, maxLength - 3) + '...'
}

export const getFileIcon = (type?: string) => {
  if (!type) return <FileUnknownFilled />

  const ext = type.toLowerCase()

  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
    return <FileImageFilled />
  }

  if (['.doc', '.docx'].includes(ext)) {
    return <FileWordFilled />
  }
  if (['.xls', '.xlsx'].includes(ext)) {
    return <FileExcelFilled />
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return <FilePptFilled />
  }
  if (ext === '.pdf') {
    return <FilePdfFilled />
  }
  if (['.md', '.markdown'].includes(ext)) {
    return <FileMarkdownFilled />
  }

  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return <FileZipFilled />
  }

  if (['.txt', '.json', '.log', '.yml', '.yaml', '.xml', '.csv', '.tscn', '.gd'].includes(ext)) {
    return <FileTextFilled />
  }

  if (['.url'].includes(ext)) {
    return <LinkOutlined />
  }

  if (['.sitemap'].includes(ext)) {
    return <GlobalOutlined />
  }

  if (['.folder'].includes(ext)) {
    return <FolderOpenFilled />
  }

  return <FileUnknownFilled />
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
            <Image
              style={{ width: 80, maxHeight: 200 }}
              src={'file://' + FileManager.getSafePath(file)}
              preview={{
                visible: visible,
                src: 'file://' + FileManager.getSafePath(file),
                onVisibleChange: setVisible
              }}
            />
          )}
          <span style={{ wordBreak: 'break-all' }}>{fullName}</span>
          {formatFileSize(file.size)}
        </ColFlex>
      }>
      <FileName
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
      </FileName>
    </Tooltip>
  )
}

const AttachmentItem: FC<{
  file: FileMetadata
  onRemove: () => void
  onPasteAsText?: (file: FileMetadata) => void
}> = ({ file, onRemove, onPasteAsText }) => {
  const { t } = useTranslation()
  const [isTextFile, setIsTextFile] = useState<boolean | null>(null)
  const probedRef = useRef(false)

  const handleOpenChange = (open: boolean) => {
    if (!open || probedRef.current) return
    probedRef.current = true
    void window.api.file
      .isTextFile(file.path)
      .then(setIsTextFile)
      .catch(() => setIsTextFile(false))
  }

  const tag = (
    <CustomTag icon={getFileIcon(file.ext)} color="#37a5aa" closable onClose={onRemove}>
      <FileNameRender file={file} />
    </CustomTag>
  )

  if (!onPasteAsText) {
    return tag
  }

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>{tag}</ContextMenuTrigger>
      {isTextFile && (
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onPasteAsText(file)}>{t('chat.input.paste_text_file')}</ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}

const AttachmentPreview: FC<Props> = ({ files, setFiles, onPasteAsText }) => {
  if (isEmpty(files)) {
    return null
  }

  return (
    <ContentContainer>
      {files.map((file) => (
        <AttachmentItem
          key={file.id}
          file={file}
          onRemove={() => setFiles(files.filter((f) => f.id !== file.id))}
          onPasteAsText={onPasteAsText}
        />
      ))}
    </ContentContainer>
  )
}

const ContentContainer = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 4px;
`

const FileName = styled.span`
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`

export default AttachmentPreview
