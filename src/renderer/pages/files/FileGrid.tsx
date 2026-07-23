import { Button } from '@cherrystudio/ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Trash2 } from 'lucide-react'
import { memo, type RefObject, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FileContextMenu, type FileContextMenuActions } from './FileContextMenu'
import type { FileItem } from './fileDisplay'
import { getFormatLabel, typeBgColors, typeIconColors, typeIcons } from './fileDisplay'
import { InlineRename } from './InlineRename'

// Decorative placeholder gradients for image thumbnails, keyed by a hash of the
// file name. Each stop uses a primitive color token from the design system
// (DESIGN.md §2 — decorative color must come from the primitive scales, never
// raw hex) so these tints stay consistent with the rest of the palette.
const GALLERY_GRADIENTS = [
  'linear-gradient(135deg,var(--color-orange-200),var(--color-rose-400))',
  'linear-gradient(135deg,var(--color-blue-300),var(--color-cyan-200))',
  'linear-gradient(135deg,var(--color-pink-200),var(--color-indigo-300))',
  'linear-gradient(135deg,var(--color-rose-200),var(--color-fuchsia-200))',
  'linear-gradient(135deg,var(--color-teal-200),var(--color-pink-200))',
  'linear-gradient(135deg,var(--color-amber-200),var(--color-orange-300))',
  'linear-gradient(135deg,var(--color-green-300),var(--color-sky-300))',
  'linear-gradient(135deg,var(--color-amber-300),var(--color-purple-400))',
  'linear-gradient(135deg,var(--color-violet-200),var(--color-sky-300))',
  'linear-gradient(135deg,var(--color-amber-300),var(--color-orange-400))',
  'linear-gradient(135deg,var(--color-slate-200),var(--color-slate-100))',
  'linear-gradient(135deg,var(--color-emerald-400),var(--color-blue-600))'
]

const GRID_GAP_PX = 8
const GRID_PADDING_PX = 12
const GRID_MIN_CARD_WIDTH_PX = 120
const GRID_ROW_ESTIMATE_PX = 180

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

function gradientFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
  return GALLERY_GRADIENTS[Math.abs(h) % GALLERY_GRADIENTS.length]
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
            className="absolute top-3 right-3 left-3 grid gap-2 pb-2"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              transform: `translateY(${virtualRow.start}px)`
            }}>
            {row.map((file) => {
              const Icon = typeIcons[file.type]
              const isRenaming = renamingId === file.id
              const isImage = file.type === 'image'
              const previewUrl = isImage && !file.isMissing ? file.previewUrl : undefined
              const shapeClass = isImage ? 'aspect-square rounded-lg' : 'h-[72px] rounded-t-lg'
              const bgClass = isImage ? '' : typeBgColors[file.type]
              return (
                <FileContextMenu key={file.id} file={file} isTrash={isTrash} actions={menuActions}>
                  <div
                    onClick={() => {
                      if (isRenaming || file.isMissing) return
                      onOpen(file)
                    }}
                    className="group relative cursor-pointer rounded-lg border border-border/30 transition-all hover:border-border/50 hover:bg-accent/50">
                    <div
                      className={`${shapeClass} relative flex items-center justify-center overflow-hidden ${bgClass}`}
                      style={isImage ? { backgroundImage: gradientFor(file.name) } : undefined}>
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={file.name}
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Icon size={22} strokeWidth={1.2} className={typeIconColors[file.type]} />
                      )}
                      {!isImage && (
                        <span className="absolute top-1.5 left-1.5 rounded bg-muted/50 px-1.5 py-[1px] font-medium text-muted-foreground/60 text-xs tracking-wide">
                          {getFormatLabel(file.format)}
                        </span>
                      )}
                      {file.isMissing && (
                        <span className="absolute bottom-1.5 left-1.5 rounded bg-destructive/10 px-1.5 py-[1px] text-[10px] text-destructive/70">
                          {t('files.missing')}
                        </span>
                      )}
                      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDelete(file.id)
                          }}
                          title={file.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')}
                          className="size-6 min-h-0 rounded bg-background/95 p-0 text-destructive/75 shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-destructive">
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="px-2 py-1.5">
                      {isRenaming ? (
                        <InlineRename
                          value={file.name}
                          onConfirm={(v) => onRenameConfirm(file.id, v)}
                          onCancel={onRenameCancel}
                          className="w-full px-1.5 text-center"
                        />
                      ) : (
                        <p className="truncate text-foreground text-sm" title={file.name}>
                          {file.name}
                        </p>
                      )}
                      <div className="mt-0.5 flex items-center gap-1">
                        <span className="text-muted-foreground/50 text-xs">{file.size}</span>
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
