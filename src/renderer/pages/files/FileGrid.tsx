import { Button, ImagePreviewTrigger } from '@cherrystudio/ui'
import { Trash2 } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { FileContextMenu, type FileContextMenuActions } from './FileContextMenu'
import type { FileItem } from './fileDisplay'
import { getFormatLabel, typeBgColors, typeIconColors, typeIcons } from './fileDisplay'
import { InlineRename } from './InlineRename'

const GALLERY_GRADIENTS = [
  'linear-gradient(135deg,#ffd3a5,#fd6585)',
  'linear-gradient(135deg,#a1c4fd,#c2e9fb)',
  'linear-gradient(135deg,#fbc2eb,#a6c1ee)',
  'linear-gradient(135deg,#fad0c4,#ffd1ff)',
  'linear-gradient(135deg,#a8edea,#fed6e3)',
  'linear-gradient(135deg,#ffecd2,#fcb69f)',
  'linear-gradient(135deg,#84fab0,#8fd3f4)',
  'linear-gradient(135deg,#fccb90,#d57eeb)',
  'linear-gradient(135deg,#e0c3fc,#8ec5fc)',
  'linear-gradient(135deg,#f6d365,#fda085)',
  'linear-gradient(135deg,#cfd9df,#e2ebf0)',
  'linear-gradient(135deg,#43cea2,#185a9d)'
]

function gradientFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
  return GALLERY_GRADIENTS[Math.abs(h) % GALLERY_GRADIENTS.length]
}

export const FileGrid = memo(function FileGrid({
  files,
  selectedIds,
  onSelect,
  onOpen,
  onDelete,
  isTrash,
  menuActions,
  renamingId,
  onRenameConfirm,
  onRenameCancel
}: {
  files: FileItem[]
  selectedIds: Set<string>
  onSelect: (id: string) => void
  onOpen: (file: FileItem) => void
  onDelete: (id: string) => void
  isTrash: boolean
  menuActions: FileContextMenuActions
  renamingId: string | null
  onRenameConfirm: (id: string, name: string) => void
  onRenameCancel: () => void
}) {
  const { t } = useTranslation()
  const imagePreviewItems = useMemo(
    () =>
      files.flatMap((file) =>
        file.type === 'image' && file.previewUrl
          ? [{ id: file.id, src: file.previewUrl, alt: file.name, title: file.name }]
          : []
      ),
    [files]
  )
  const previewLabels = useMemo(
    () => ({
      close: t('preview.close'),
      dialogTitle: t('preview.label'),
      flipHorizontal: t('preview.flip_horizontal'),
      flipVertical: t('preview.flip_vertical'),
      next: t('preview.next'),
      previous: t('preview.previous'),
      reset: t('preview.reset'),
      rotateLeft: t('preview.rotate_left'),
      rotateRight: t('preview.rotate_right'),
      zoomIn: t('preview.zoom_in'),
      zoomOut: t('preview.zoom_out')
    }),
    [t]
  )

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 p-3">
      {files.map((file) => {
        const selected = selectedIds.has(file.id)
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
                if (isRenaming) return
                if (previewUrl) return
                onSelect(file.id)
              }}
              onDoubleClick={() => {
                if (!isRenaming && !previewUrl && !file.isMissing) onOpen(file)
              }}
              className={`group relative cursor-pointer rounded-lg border transition-all ${
                selected
                  ? 'border-border/50 bg-accent/50'
                  : 'border-border/30 hover:border-border/50 hover:bg-accent/50'
              }`}>
              <div
                className={`${shapeClass} relative flex items-center justify-center overflow-hidden ${bgClass}`}
                style={isImage ? { backgroundImage: gradientFor(file.name) } : undefined}>
                {previewUrl ? (
                  <ImagePreviewTrigger
                    item={{ id: file.id, src: previewUrl, alt: file.name, title: file.name }}
                    items={imagePreviewItems}
                    alt={file.name}
                    dialogProps={{ labels: previewLabels }}
                    className="h-full w-full cursor-zoom-in object-cover"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
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
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(file.id)
                    }}
                    title={file.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')}
                    className="flex h-5 w-5 items-center justify-center rounded bg-background/80 p-0 text-destructive/70 shadow-sm backdrop-blur transition-colors hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 size={10} />
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
})
