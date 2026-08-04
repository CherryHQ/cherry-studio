import { Button } from '@cherrystudio/ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Trash2 } from 'lucide-react'
import { memo, type RefObject, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FileContextMenu, type FileContextMenuActions } from './FileContextMenu'
import type { FileItem } from './fileDisplay'
import { getFormatLabel, typeBgColors, typeIconColors, typeIcons } from './fileDisplay'
import { InlineRename } from './InlineRename'

const GRID_GAP_PX = 12
const GRID_PADDING_PX = 12
const GRID_MIN_CARD_WIDTH_PX = 156
const GRID_ROW_ESTIMATE_PX = 220

function getGridColumnCount(width: number) {
  const innerWidth = Math.max(0, width - GRID_PADDING_PX * 2)
  return Math.max(1, Math.floor((innerWidth + GRID_GAP_PX) / (GRID_MIN_CARD_WIDTH_PX + GRID_GAP_PX)))
}

function useGridColumnCount(scrollRef: RefObject<HTMLDivElement | null>) {
  const [columnCount, setColumnCount] = useState(1)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const update = () => setColumnCount(getGridColumnCount(element.clientWidth))
    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [scrollRef])

  return columnCount
}

export const FileGrid = memo(function FileGrid({
  files,
  onOpen,
  onDelete,
  isTrash,
  menuActions,
  scrollRef,
  onLayoutChange,
  renamingId,
  onRenameConfirm,
  onRenameCancel
}: {
  files: FileItem[]
  onOpen: (file: FileItem) => void
  onDelete: (id: string) => void
  isTrash: boolean
  menuActions: FileContextMenuActions
  scrollRef: RefObject<HTMLDivElement | null>
  onLayoutChange: () => void
  renamingId: string | null
  onRenameConfirm: (id: string, name: string) => void
  onRenameCancel: () => void
}) {
  const { t } = useTranslation()
  const columnCount = useGridColumnCount(scrollRef)
  const rows = useMemo(() => {
    const nextRows: FileItem[][] = []
    for (let index = 0; index < files.length; index += columnCount) {
      nextRows.push(files.slice(index, index + columnCount))
    }
    return nextRows
  }, [columnCount, files])
  const getRowKey = useCallback((index: number) => rows[index]?.[0]?.id ?? index, [rows])
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRID_ROW_ESTIMATE_PX,
    getItemKey: getRowKey,
    overscan: 4
  })
  const totalSize = rowVirtualizer.getTotalSize()

  useEffect(() => {
    onLayoutChange()
  }, [columnCount, onLayoutChange, totalSize])

  return (
    <div className="relative p-3" style={{ height: totalSize + GRID_PADDING_PX * 2 }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index] ?? []
        return (
          <div
            key={row[0]?.id ?? virtualRow.key}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute top-3 right-3 left-3 grid gap-3 pb-3"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              transform: `translateY(${virtualRow.start}px)`
            }}>
            {row.map((file) => {
              const Icon = typeIcons[file.type]
              const isRenaming = renamingId === file.id
              const isImage = file.type === 'image'
              const previewUrl = isImage && !file.isMissing ? file.previewUrl : undefined
              const shapeClass = isImage ? 'aspect-square' : 'h-24'
              return (
                <FileContextMenu key={file.id} file={file} isTrash={isTrash} actions={menuActions}>
                  <div
                    onClick={() => {
                      if (isRenaming || file.isMissing) return
                      onOpen(file)
                    }}
                    className="group relative cursor-pointer rounded-lg border border-border-subtle bg-card p-1 transition-colors hover:border-border-strong hover:bg-accent">
                    <div
                      className={`${shapeClass} relative flex items-center justify-center overflow-hidden rounded-md border border-border-subtle ${typeBgColors[file.type]}`}>
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={file.name}
                          draggable={false}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Icon size={24} strokeWidth={1.2} className={typeIconColors[file.type]} />
                      )}
                      {!isImage && (
                        <span className="absolute top-1.5 left-1.5 rounded bg-background/70 px-1.5 py-px font-medium text-muted-foreground text-xs tracking-wide backdrop-blur-sm">
                          {getFormatLabel(file.format)}
                        </span>
                      )}
                      {file.isMissing && (
                        <span className="absolute bottom-1.5 left-1.5 rounded bg-background/80 px-1.5 py-px text-[10px] text-destructive backdrop-blur-sm">
                          {t('files.missing')}
                        </span>
                      )}
                      <div className="absolute top-1.5 right-1.5 flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDelete(file.id)
                          }}
                          aria-label={
                            file.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')
                          }
                          title={file.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')}
                          className="!text-muted-foreground hover:!text-destructive size-6 min-h-0 rounded bg-background/80 p-0 shadow-xs backdrop-blur-sm transition-colors">
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="px-1 pt-1.5 pb-0.5">
                      {isRenaming ? (
                        <InlineRename
                          value={file.name}
                          onConfirm={(v) => onRenameConfirm(file.id, v)}
                          onCancel={onRenameCancel}
                          className="w-full px-1.5 text-center"
                        />
                      ) : (
                        <p className="truncate font-medium text-foreground text-sm leading-5" title={file.name}>
                          {file.name}
                        </p>
                      )}
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground text-xs leading-4">{file.size}</span>
                      </div>
                    </div>
                  </div>
                </FileContextMenu>
              )
            })}
          </div>
        )
      })}
    </div>
  )
})
