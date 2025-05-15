import { FC } from 'react'

import RemoteFileList from './RemoteFileList'

interface MistralFilesProps {
  id: string
}

const MistralFiles: FC<MistralFilesProps> = ({ id }) => {
  const formatFileDate = (date: string | number): string => {
    if (typeof date === 'number') {
      return new Date(date * 1000).toLocaleString()
    }
    return new Date(date).toLocaleString()
  }

  const formatFileSize = (size: string | number): string => {
    const sizeNumber = typeof size === 'string' ? parseInt(size) : size
    return `${(sizeNumber / 1024 / 1024).toFixed(2)} MB`
  }

  return <RemoteFileList id={id} formatFileDate={formatFileDate} formatFileSize={formatFileSize} />
}

export default MistralFiles
