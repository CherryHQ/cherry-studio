import { DeleteIcon } from '@renderer/components/Icons'
import ImageViewer from '@renderer/components/ImageViewer'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { handleDelete } from '@renderer/services/FileAction'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata, FileType } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { t } from 'i18next'
import { CircleAlert } from 'lucide-react'
import React, { memo, useCallback } from 'react'

import FileItem from './FileItem'

interface FileItemProps {
  id: FileType | 'all' | string
  list: {
    key: FileType | 'all' | string
    file: React.ReactNode
    files?: FileMetadata[]
    count?: number
    size: string
    ext: string
    created_at: string
    actions: React.ReactNode
  }[]
  files?: FileMetadata[]
}

const FileList: React.FC<FileItemProps> = ({ id, list, files }) => {
  const estimateSize = useCallback(() => 75, [])

  if (id === FILE_TYPE.IMAGE && files?.length && files?.length > 0) {
    const previewItems = files.map((file) => ({
      alt: FileManager.formatFileName(file),
      id: file.id,
      src: FileManager.getFileUrl(file)
    }))

    return (
      <div className="overflow-y-auto p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
          {files.map((file, index) => (
            <div
              className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-background-subtle"
              key={file.id}>
              <div className="absolute inset-0 flex items-center justify-center bg-background-subtle">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white/90" />
              </div>
              <ImageViewer
                alt={FileManager.formatFileName(file)}
                className="h-full w-full cursor-pointer object-cover opacity-0 transition-[opacity,transform] duration-300 [&.loaded]:opacity-100 group-hover:[&.loaded]:scale-105"
                preview={{
                  defaultActiveIndex: index,
                  items: previewItems
                }}
                src={FileManager.getFileUrl(file)}
                onLoad={(e) => {
                  const img = e.target as HTMLImageElement
                  img.classList.add('loaded')
                }}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-2 py-[5px] text-white text-xs opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <div className="truncate">{formatFileSize(file.size)}</div>
              </div>
              <button
                className="absolute top-2 right-2 z-[1] flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity duration-300 hover:bg-red-600/80 group-hover:opacity-100"
                title={t('files.delete.title')}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  window.modal.confirm({
                    title: t('files.delete.title'),
                    content: t('files.delete.content'),
                    okText: t('common.confirm'),
                    cancelText: t('common.cancel'),
                    centered: true,
                    onOk: () => {
                      void handleDelete(file.id, t)
                    },
                    icon: <CircleAlert className="size-4 text-red-500" />
                  })
                }}>
                <DeleteIcon size={14} className="lucide-custom" />
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <DynamicVirtualList
      list={list}
      estimateSize={estimateSize}
      overscan={2}
      scrollerStyle={{
        padding: '0 16px 16px 16px'
      }}
      itemContainerStyle={{
        height: '75px',
        paddingTop: '12px'
      }}>
      {(item) => (
        <FileItem
          key={item.key}
          fileInfo={{
            name: item.file,
            ext: item.ext,
            extra: `${item.created_at} · ${item.count}${t('files.count')} · ${item.size}`,
            actions: item.actions
          }}
        />
      )}
    </DynamicVirtualList>
  )
}

export default memo(FileList)
