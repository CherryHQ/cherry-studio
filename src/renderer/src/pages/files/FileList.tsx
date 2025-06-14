import { FileType, FileTypes } from '@renderer/types'
import { t } from 'i18next'
import VirtualList from 'rc-virtual-list'
import React, { memo } from 'react'

import FileItem from './FileItem'
import ImageList from './ImageList'

interface FileListProps {
  id: FileTypes | 'all' | string
  list: {
    key: FileTypes | 'all' | string
    file: React.ReactNode
    files?: FileType[]
    count?: number
    size: string
    ext: string
    created_at: string
    actions: React.ReactNode
  }[]
  files?: FileType[]
}

const FileList: React.FC<FileListProps> = ({ id, list, files }) => {
  if (id === FileTypes.IMAGE && files?.length && files?.length > 0) {
    return <ImageList files={files}></ImageList>
  }

  return (
    <VirtualList
      data={list}
      height={window.innerHeight - 100}
      itemHeight={75}
      itemKey="key"
      style={{ padding: '0 16px 16px 16px' }}
      styles={{
        verticalScrollBar: {
          width: 6
        },
        verticalScrollBarThumb: {
          background: 'var(--color-scrollbar-thumb)'
        }
      }}>
      {(item) => (
        <div
          style={{
            height: '75px',
            paddingTop: '12px'
          }}>
          <FileItem
            key={item.key}
            fileInfo={{
              name: item.file,
              ext: item.ext,
              extra: `${item.created_at} · ${item.count}${t('files.count')} · ${item.size}`,
              actions: item.actions
            }}
          />
        </div>
      )}
    </VirtualList>
  )
}

export default memo(FileList)
