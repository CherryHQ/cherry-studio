import { Button, Dialog, DialogContent } from '@cherrystudio/ui'
import { Clock, File, FileText, HardDrive, Image as ImageIcon, Music, Video, X } from 'lucide-react'
import type { FC } from 'react'
import { memo } from 'react'

import type { FileItem } from './mockData'
import { getFormatLabel } from './mockData'

const typeIcons: Record<string, FC<{ size?: number; className?: string }>> = {
  image: ImageIcon,
  document: FileText,
  text: FileText,
  audio: Music,
  video: Video,
  other: File
}

const typeIconColors: Record<string, string> = {
  image: 'text-pink-500/50',
  document: 'text-blue-500/50',
  text: 'text-cyan-500/50',
  audio: 'text-amber-500/50',
  video: 'text-violet-500/50',
  other: 'text-muted-foreground/40'
}

function DetailRow({
  icon: Icon,
  label,
  value
}: {
  icon: FC<{ size?: number; className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={10} className="mt-[2px] shrink-0 text-muted-foreground/40" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground/60">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{value}</p>
      </div>
    </div>
  )
}

export const FilePreview = memo(function FilePreview({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const Icon = typeIcons[file.type] || File

  const renderPreviewContent = () => {
    if (file.type === 'image') {
      return (
        <div className="flex flex-1 items-center justify-center rounded-lg bg-muted/15 p-4">
          <div className="flex aspect-[4/3] w-full max-w-[360px] items-center justify-center rounded-lg bg-muted/20">
            <ImageIcon size={48} className="text-pink-500/15" />
          </div>
        </div>
      )
    }
    if (file.type === 'audio') {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-muted/30">
          <Music size={40} className="text-amber-500/20" />
          <div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 rounded-full bg-amber-500/25" />
          </div>
          <span className="text-xs text-muted-foreground/40">03:24 / 12:08</span>
        </div>
      )
    }
    if (file.type === 'video') {
      return (
        <div className="flex flex-1 items-center justify-center rounded-lg bg-muted/30">
          <div className="relative">
            <Video size={40} className="text-violet-500/20" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                <div className="ml-0.5 h-0 w-0 border-b-[4px] border-l-[6px] border-t-[4px] border-b-transparent border-l-border border-t-transparent" />
              </div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg bg-muted/30">
        <File size={40} className="text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}>
      <DialogContent
        className="flex max-h-[85vh] w-[680px] max-w-[90vw] flex-col overflow-hidden p-0"
        showCloseButton={false}>
        <div className="flex items-center gap-3 border-b border-border/30 px-5 py-3">
          <Icon size={15} className={typeIconColors[file.type] || typeIconColors.other} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-foreground">{file.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground/60">
              {getFormatLabel(file.format)} · {file.size}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md p-0 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-foreground">
            <X size={13} />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden p-4">{renderPreviewContent()}</div>
          <div className="w-[200px] shrink-0 overflow-y-auto border-l border-border/30 p-4">
            <h4 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground/60">详细信息</h4>
            <div className="space-y-3">
              <DetailRow icon={HardDrive} label="大小" value={file.size} />
              <DetailRow icon={FileText} label="格式" value={getFormatLabel(file.format)} />
              <DetailRow icon={Clock} label="创建" value={file.createdAt} />
              <DetailRow icon={Clock} label="修改" value={file.updatedAt} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
})
