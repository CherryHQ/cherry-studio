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
  LinkOutlined,
  VideoCameraFilled
} from '@ant-design/icons'
import { ColFlex } from '@cherrystudio/ui'
import { videoExts } from '@shared/utils/file'
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

  if (videoExts.includes(ext)) {
    return <VideoCameraFilled />
  }

  return <FileUnknownFilled />
}

const FileItem: React.FC<FileItemProps> = ({ fileInfo, style }) => {
  const { name, ext, extra, actions, icon } = fileInfo

  return (
    <div
      className="shrink-0 overflow-hidden rounded-lg border-[0.5px] border-[var(--color-border)] transition-[box-shadow,background-color] duration-200 [--shadow-color:rgba(0,0,0,0.05)] hover:shadow-[0_10px_15px_-3px_var(--shadow-color),0_4px_6px_-4px_var(--shadow-color)] [body[theme-mode='dark']_&]:[--shadow-color:rgba(255,255,255,0.02)]"
      style={style}>
      <div className="flex items-stretch gap-4 py-2 pr-2 pl-4">
        <div className="flex max-h-11 items-center justify-center text-[32px] text-[var(--color-text-3)]">
          {icon || getFileIcon(ext)}
        </div>
        <ColFlex className="w-0 flex-1 justify-center gap-0">
          <div className="cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-[15px] transition-colors duration-200 hover:text-[var(--color-primary)] [&_span]:text-[15px]">
            {name}
          </div>
          {extra && <div className="text-[13px] text-[var(--color-text-2)]">{extra}</div>}
        </ColFlex>
        <div className="flex max-h-11 items-center justify-center">{actions}</div>
      </div>
    </div>
  )
}

export default memo(FileItem)
