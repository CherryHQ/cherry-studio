import { ColFlex } from '@cherrystudio/ui'
import { videoExts } from '@shared/utils/file'
import {
  FileArchive,
  FileImage,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  FolderOpen,
  Globe,
  Link,
  Presentation
} from 'lucide-react'
import React, { memo } from 'react'
import styled from 'styled-components'

interface FileItemProps {
  fileInfo: {
    icon?: React.ReactNode
    name: React.ReactNode | string
    ext: string
    extra?: React.ReactNode | string
    actions: React.ReactNode
  }
  style?: React.CSSProperties
}

const getFileIcon = (type?: string) => {
  if (!type) return <FileQuestion />

  const ext = type.toLowerCase()

  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
    return <FileImage />
  }

  if (['.doc', '.docx'].includes(ext)) {
    return <FileType2 />
  }
  if (['.xls', '.xlsx'].includes(ext)) {
    return <FileSpreadsheet />
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return <Presentation />
  }
  if (ext === '.pdf') {
    return <FileText />
  }
  if (['.md', '.markdown'].includes(ext)) {
    return <FileText />
  }

  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return <FileArchive />
  }

  if (['.txt', '.json', '.log', '.yml', '.yaml', '.xml', '.csv'].includes(ext)) {
    return <FileText />
  }

  if (['.url'].includes(ext)) {
    return <Link />
  }

  if (['.sitemap'].includes(ext)) {
    return <Globe />
  }

  if (['.folder'].includes(ext)) {
    return <FolderOpen />
  }

  if (videoExts.includes(ext)) {
    return <FileVideo />
  }

  return <FileQuestion />
}

const FileItem: React.FC<FileItemProps> = ({ fileInfo, style }) => {
  const { name, ext, extra, actions, icon } = fileInfo

  return (
    <FileItemCard style={style}>
      <CardContent>
        <FileIcon>{icon || getFileIcon(ext)}</FileIcon>
        <ColFlex className="w-0 flex-1 justify-center gap-0">
          <FileName>{name}</FileName>
          {extra && <FileInfo>{extra}</FileInfo>}
        </ColFlex>
        <FileActions>{actions}</FileActions>
      </CardContent>
    </FileItemCard>
  )
}

const FileItemCard = styled.div`
  border-radius: 8px;
  overflow: hidden;
  border: 0.5px solid var(--color-border);
  flex-shrink: 0;
  transition:
    box-shadow 0.2s ease,
    background-color 0.2s ease;
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
  padding: 8px 8px 8px 16px;
  display: flex;
  align-items: stretch;
  gap: 16px;
`

const FileIcon = styled.div`
  max-height: 44px;
  color: var(--color-text-3);
  font-size: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const FileName = styled.div`
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color 0.2s ease;
  span {
    font-size: 15px;
  }
  &:hover {
    color: var(--color-primary);
  }
`

const FileInfo = styled.div`
  font-size: 13px;
  color: var(--color-text-2);
`

const FileActions = styled.div`
  max-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
`

export default memo(FileItem)
