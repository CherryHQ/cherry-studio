import { Button } from '@cherrystudio/ui'
import FileManager from '@renderer/services/FileManager'
import { cn } from '@renderer/utils/style'
import {
  AlertTriangle,
  Copy,
  Download,
  type LucideIcon,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2
} from 'lucide-react'
import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingEntry } from '../../model/groupPaintings'
import type { PaintingData } from '../../model/types/paintingData'

export interface PaintingListEntryActions {
  onEdit: (source: PaintingData) => void
  onRegenerate: (source: PaintingData) => void
  onAddToChat: (source: PaintingData) => void
  onDownload: (source: PaintingData) => void
  onCopyPrompt: (source: PaintingData) => void
  onDelete: (source: PaintingData) => void
  onRetry: (source: PaintingData) => void
}

interface PaintingListEntryProps extends PaintingListEntryActions {
  entry: PaintingEntry
  /** In-flight placeholder: render N skeletons instead of images, no actions. */
  pending?: boolean
}

/**
 * One generation in the message-list feed: the prompt on top, its image(s) in a
 * row below, and a hover action bar. A multi-image group is one entry (a row of
 * thumbnails). Derive ops act on the first image; download / delete act on all.
 */
const PaintingListEntry: FC<PaintingListEntryProps> = ({
  entry,
  pending,
  onEdit,
  onRegenerate,
  onAddToChat,
  onDownload,
  onCopyPrompt,
  onDelete,
  onRetry
}) => {
  const { t } = useTranslation()
  const { paintings } = entry
  const primary = paintings[0]
  const files = useMemo(() => paintings.flatMap((p) => p.files), [paintings])
  const failed = !pending && files.length === 0 && primary.status != null && primary.status !== 'succeeded'

  const actions = useMemo<{ id: string; icon: LucideIcon; label: string; run: () => void; destructive?: boolean }[]>(
    () => [
      { id: 'edit', icon: Pencil, label: t('paintings.canvas.op.edit'), run: () => onEdit(primary) },
      {
        id: 'regenerate',
        icon: RefreshCw,
        label: t('paintings.canvas.op.regenerate'),
        run: () => onRegenerate(primary)
      },
      {
        id: 'add_to_chat',
        icon: MessageSquarePlus,
        label: t('paintings.canvas.op.add_to_chat'),
        run: () => onAddToChat(primary)
      },
      {
        id: 'download',
        icon: Download,
        label: t('paintings.canvas.menu.download'),
        run: () => paintings.forEach(onDownload)
      },
      ...(primary.prompt
        ? [{ id: 'copy', icon: Copy, label: t('paintings.canvas.menu.copy_prompt'), run: () => onCopyPrompt(primary) }]
        : []),
      {
        id: 'delete',
        icon: Trash2,
        label: t('common.delete'),
        run: () => paintings.forEach(onDelete),
        destructive: true
      }
    ],
    [t, primary, paintings, onEdit, onRegenerate, onAddToChat, onDownload, onCopyPrompt, onDelete]
  )

  return (
    <div className="group flex flex-col gap-2 rounded-xl px-3 py-3 transition hover:bg-muted/30">
      {primary.prompt && <div className="text-foreground/90 text-sm">{primary.prompt}</div>}

      <div className="flex flex-wrap items-start gap-2">
        {pending ? (
          paintings.map((p) => <div key={p.id} className="animation-shimmer-block size-44 rounded-lg" />)
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-secondary px-6 py-8 text-center">
            <AlertTriangle className="size-7 text-destructive/70" />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(primary)}>
              <RotateCcw className="size-3.5" />
              {t('paintings.canvas.retry')}
            </Button>
          </div>
        ) : (
          files.map((file) => (
            <img
              key={file.id}
              src={FileManager.getFileUrl(file)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="max-h-64 rounded-lg border border-border-subtle object-contain"
            />
          ))
        )}
      </div>

      {!pending && !failed && files.length > 0 && (
        <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          {actions.map(({ id, icon: Icon, label, run, destructive }) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant="ghost"
              title={label}
              aria-label={label}
              className={cn(
                'size-7 px-0 text-muted-foreground hover:text-foreground',
                destructive && 'hover:text-destructive'
              )}
              onClick={run}>
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export default PaintingListEntry
