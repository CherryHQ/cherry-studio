import { MB } from '@shared/config/constant'
import dayjs from 'dayjs'
import { FC } from 'react'

import RemoteFileList from './RemoteFileList'

interface GeminiFilesProps {
  id: string
}

const GeminiFiles: FC<GeminiFilesProps> = ({ id }) => {
  const formatFileDate = (date: string | number): string => {
    return dayjs(date).format('MM-DD HH:mm')
  }

  const formatFileSize = (size: string | number): string => {
    const sizeNumber = typeof size === 'string' ? parseInt(size) : size
    return `${(sizeNumber / MB).toFixed(2)} MB`
  }

  return <RemoteFileList id={id} formatFileDate={formatFileDate} formatFileSize={formatFileSize} />
}

export default GeminiFiles
