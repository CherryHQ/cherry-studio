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
import CustomTag from '@renderer/components/CustomTag'
import FileManager from '@renderer/services/FileManager'
import { FileType } from '@renderer/types'
import type { FileMessageBlock } from '@renderer/types/newMessage'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  block: FileMessageBlock
}

const MessageAttachments: FC<Props> = ({ block }) => {
  if (!block.file) {
    return null
  }

  const MAX_FILENAME_DISPLAY_LENGTH = 20
  function truncateFileName(name: string, maxLength: number = MAX_FILENAME_DISPLAY_LENGTH) {
    if (name.length <= maxLength) return name
    return name.slice(0, maxLength - 3) + '...'
  }

  const getFileIcon = (type?: string) => {
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

    if (['.txt', '.json', '.log', '.yml', '.yaml', '.xml', '.csv'].includes(ext)) {
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

  const FileNameRender: FC<{ file: FileType }> = ({ file }) => {
    const fullName = FileManager.formatFileName(file)
    const displayName = truncateFileName(fullName)

    return (
      <FileName
        onClick={() => {
          const path = FileManager.getSafePath(file)
          if (path) {
            window.api.file.openPath(path)
          }
        }}
        title={fullName}>
        {displayName}
      </FileName>
    )
  }

  return (
    <Container style={{ marginTop: 2, marginBottom: 8 }} className="message-attachments">
      <CustomTag key={block.file.id} icon={getFileIcon(block.file.ext)} color="#37a5aa">
        <FileNameRender file={block.file} />
      </CustomTag>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 8px;
`

const FileName = styled.span`
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`

export default MessageAttachments
