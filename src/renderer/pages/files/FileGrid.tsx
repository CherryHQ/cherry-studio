import { Button, ImagePreviewTrigger, Input } from '@cherrystudio/ui'
import { File, FileCode, FileText, Image as ImageIcon, Music, Trash2, Video } from 'lucide-react'
import type { FC } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileItem } from './fileDisplay'
import { getFormatLabel } from './fileDisplay'

const typeIcons: Record<string, FC<{ size?: number; strokeWidth?: number; className?: string }>> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: FileCode,
  document: FileText,
  other: File
}

const typeIconColors: Record<string, string> = {
  image: 'text-pink-500/50',
  video: 'text-violet-500/50',
  audio: 'text-amber-500/50',
  text: 'text-cyan-500/50',
  document: 'text-blue-500/50',
  other: 'text-muted-foreground/50'
}

const typeBgColors: Record<string, string> = {
  image: 'bg-pink-500/[0.04]',
  video: 'bg-violet-500/[0.04]',
  audio: 'bg-amber-500/[0.04]',
  text: 'bg-cyan-500/[0.04]',
  document: 'bg-blue-500/[0.04]',
  other: 'bg-muted/20'
}

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
  onContextMenu,
  onOpen,
  onDelete,
  renamingId,
  onRenameConfirm,
  onRenameCancel
}: {
  files: FileItem[]
  selectedIds: Set<string>
  onSelect: (id: string, multi: boolean) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  onOpen: (file: FileItem) => void
  onDelete: (id: string) => void
  renamingId: string | null
  onRenameConfirm: (id: string, name: string) => void
  onRenameCancel: () => void
}) {
  const { t } = useTranslation()
  const imagePreviewItems = useMemo(
    () =>
      files.flatMap((file) =>
        file.type === 'image' ? [{ id: file.id, src: file.previewUrl, alt: file.name, title: file.name }] : []
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
        const Icon = typeIcons[file.type] || File
        const isRenaming = renamingId === file.id
        const isImage = file.type === 'image'
        return (
          <div
            key={file.id}
            onClick={(e) => {
              if (isRenaming) return
              if (isImage) return
              onSelect(file.id, e.metaKey || e.ctrlKey)
            }}
            onContextMenu={(e) => onContextMenu(e, file.id)}
            onDoubleClick={() => {
              if (!isRenaming && !isImage) onOpen(file)
            }}
            className={`group relative cursor-pointer rounded-lg border transition-all ${
              selected ? 'border-border/50 bg-accent/50' : 'border-border/30 hover:border-border/50 hover:bg-accent/50'
            }`}>
            <div
              className={`${isImage ? 'aspect-square rounded-lg' : 'h-[72px] rounded-t-lg'} relative flex items-center justify-center overflow-hidden ${isImage ? '' : typeBgColors[file.type] || typeBgColors.other}`}
              style={isImage ? { backgroundImage: gradientFor(file.name) } : undefined}>
              {file.type === 'image' ? (
                <ImagePreviewTrigger
                  item={{ id: file.id, src: file.previewUrl, alt: file.name, title: file.name }}
                  items={imagePreviewItems}
                  alt={file.name}
                  dialogProps={{ labels: previewLabels }}
                  className="h-full w-full cursor-zoom-in object-cover"
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
              ) : (
                <Icon size={22} strokeWidth={1.2} className={typeIconColors[file.type] || typeIconColors.other} />
              )}
              {!isImage && (
                <span className="absolute top-1.5 left-1.5 rounded bg-muted/50 px-1.5 py-[1px] font-medium text-muted-foreground/60 text-xs tracking-wide">
                  {getFormatLabel(file.format)}
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
                  className="flex h-5 w-5 items-center justify-center rounded p-0 text-muted-foreground/35 transition-colors hover:text-destructive/80">
                  <Trash2 size={10} />
                </Button>
              </div>
            </div>
            {!isImage && (
              <div className="px-2 py-1.5">
                {isRenaming ? (
                  <InlineRename
                    value={file.name}
                    onConfirm={(v) => onRenameConfirm(file.id, v)}
                    onCancel={onRenameCancel}
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
            )}
          </div>
        )
      })}
    </div>
  )
})

function InlineRename({
  value,
  onConfirm,
  onCancel
}: {
  value: string
  onConfirm: (v: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.focus()
      const dotIdx = value.lastIndexOf('.')
      ref.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : value.length)
    }
  }, [value])
  return (
    <Input
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && text.trim()) onConfirm(text.trim())
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => {
        if (text.trim()) onConfirm(text.trim())
        else onCancel()
      }}
      className="h-auto w-full rounded-md border border-border bg-background px-1.5 py-0.5 text-center text-foreground text-xs shadow-sm focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/15"
      onClick={(e) => e.stopPropagation()}
    />
  )
}
