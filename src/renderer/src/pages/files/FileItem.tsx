import { ColFlex } from '@cherrystudio/ui'
import { videoExts } from '@shared/config/constant'
import {
  File,
  FileArchive,
  FilePen,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  Image,
  Link,
  Video
} from 'lucide-react'
import React, { memo } from 'react'

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
    return <Image />
  }

  if (['.doc', '.docx', '.pdf', '.md', '.markdown'].includes(ext)) {
    return <File />
  }
  if (['.xls', '.xlsx'].includes(ext)) {
    return <FileSpreadsheet />
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return <FilePen />
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
    return <Folder />
  }

  if (videoExts.includes(ext)) {
    return <Video />
  }

  return <FileQuestion />
}

const FileItem: React.FC<FileItemProps> = ({ fileInfo, style }) => {
  const { name, ext, extra, actions, icon } = fileInfo

  return (
    <div
      className="flex-shrink-0 overflow-hidden rounded-lg border-[0.5px] border-[var(--color-border)] transition-all duration-200 hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05),0_4px_6px_-4px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_10px_15px_-3px_rgba(255,255,255,0.02),0_4px_6px_-4px_rgba(255,255,255,0.02)]"
      style={style}>
      <div className="flex items-stretch gap-4 p-2 pl-4">
        <div className="flex max-h-11 items-center justify-center text-[32px] text-[var(--color-text-3)]">
          {icon || getFileIcon(ext)}
        </div>
        <ColFlex className="w-0 flex-1 justify-center gap-0">
          <div className="cursor-pointer truncate whitespace-nowrap text-[15px] transition-colors duration-200 hover:text-[var(--color-primary)]">
            <span className="text-[15px]">{name}</span>
          </div>
          {extra && <div className="text-[13px] text-[var(--color-text-2)]">{extra}</div>}
        </ColFlex>
        <div className="flex max-h-11 items-center justify-center">{actions}</div>
      </div>
    </div>
  )
}

export default memo(FileItem)
