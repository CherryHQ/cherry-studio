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
import { Flex } from 'antd'
import React, { memo } from 'react'
import styled from 'styled-components'

interface FileItemProps {
  fileInfo: {
    name: React.ReactNode | string
    ext: string
    extra?: React.ReactNode | string
    actions: React.ReactNode
  }
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

const FileItem: React.FC<FileItemProps> = ({ fileInfo }) => {
  const { name, ext, extra, actions } = fileInfo

  return (
    <FileItemCard>
      <CardContent>
        <FileIcon>{getFileIcon(ext)}</FileIcon>
        <Flex vertical gap={0} flex={1} style={{ width: '0px' }}>
          <FileName>{name}</FileName>
          {extra && <FileInfo>{extra}</FileInfo>}
        </Flex>
        {actions}
      </CardContent>
    </FileItemCard>
  )
}

const FileItemCard = styled.div`
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  overflow: hidden;
  border: 0.5px solid var(--color-border);
  flex-shrink: 0;
  transition: box-shadow 0.2s ease;
  --shadow-color: rgba(0, 0, 0, 0.05);
  &:hover {
    box-shadow:
      0 10px 15px -3px var(--shadow-color),
      0 4px 6px -4px var(--shadow-color);
  }
  body[theme-mode='dark'] & {
    --shadow-color: rgba(255, 255, 255, 0.02);
  }
`

const CardContent = styled.div`
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
`

const FileIcon = styled.div`
  color: var(--color-text-3);
  font-size: 32px;
`

const FileName = styled.div`
  font-size: 15px;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color 0.2s ease;
  span {
    font-size: 15px;
    font-weight: bold;
  }
  &:hover {
    color: var(--color-primary);
  }
`

const FileInfo = styled.div`
  font-size: 13px;
  color: var(--color-text-2);
`

export default memo(FileItem)
