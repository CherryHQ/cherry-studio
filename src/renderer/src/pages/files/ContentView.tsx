import { type ColumnDef, DataTable } from '@cherrystudio/ui'
import ImageViewer from '@renderer/components/ImageViewer'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata, FileType } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import React, { memo } from 'react'

interface ContentViewProps {
  id: FileType | 'all' | string
  files?: FileMetadata[]
  dataSource?: any[]
  columns: any[]
}

type TableRecord = { key: React.Key } & Record<string, unknown>

const toDataTableColumns = (columns: any[]): ColumnDef<TableRecord, unknown>[] =>
  columns.map((column, index) => {
    const dataIndex = typeof column.dataIndex === 'string' ? column.dataIndex : undefined

    return {
      id: String(column.key ?? dataIndex ?? index),
      header: column.title,
      cell: ({ row }) => {
        const value = dataIndex ? row.original[dataIndex] : undefined
        return column.render ? column.render(value, row.original, row.index) : (value as React.ReactNode)
      },
      meta: {
        align: column.align,
        width: column.width
      }
    }
  })

const ContentView: React.FC<ContentViewProps> = ({ id, files, dataSource, columns }) => {
  if (id === FILE_TYPE.IMAGE && files?.length && files?.length > 0) {
    const previewItems = files.map((file) => ({
      alt: FileManager.formatFileName(file),
      id: file.id,
      src: FileManager.getFileUrl(file)
    }))

    return (
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
          </div>
        ))}
      </div>
    )
  }

  return (
    <DataTable
      className="w-full"
      data={(dataSource ?? []) as TableRecord[]}
      columns={toDataTableColumns(columns)}
      rowKey="key"
    />
  )
}

export default memo(ContentView)
