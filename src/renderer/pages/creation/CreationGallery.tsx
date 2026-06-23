import { Button, ConfirmDialog, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import FileManager from '@renderer/services/FileManager'
import type { CreationKind } from '@shared/data/types/creation'
import { Film, Loader2, Plus, Trash2 } from 'lucide-react'
import type { FC, UIEventHandler } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { creationClasses } from './creationPrimitives'
import type { CreationGalleryEntry } from './useCreationHistory'

interface CreationGalleryProps {
  kind?: CreationKind
  selectedCreationId?: string
  /** Id of the creation with an in-flight generation, or undefined when idle. */
  runningCreationId?: string
  items: CreationGalleryEntry[]
  hasMore: boolean
  loadMore: () => void
  onDeleteCreation: (creation: CreationGalleryEntry) => void
  onSelectCreation: (creation: CreationGalleryEntry) => void
  onAddCreation: () => void
}

const CreationGalleryItem: FC<{
  creation: CreationGalleryEntry
  selected: boolean
  loading: boolean
  onDelete: (creation: CreationGalleryEntry) => void
  onSelect: (creation: CreationGalleryEntry) => void
  selectLabel: string
  deleteLabel: string
}> = ({ creation, selected, loading, onDelete, onSelect, selectLabel, deleteLabel }) => {
  const itemKind = creation.kind
  const previewFile = creation.files?.[0]
  const previewUrl = previewFile ? FileManager.getFileUrl(previewFile) : undefined

  return (
    <div className={cn(creationClasses.historyItem, selected && creationClasses.historyItemActive)}>
      <button
        type="button"
        className="absolute inset-0 z-0"
        aria-label={selectLabel}
        onClick={() => onSelect(creation)}>
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[12px]">
          {previewUrl && itemKind === 'video' ? (
            <video src={previewUrl} muted preload="metadata" className="h-full w-full object-cover">
              <track kind="captions" />
            </video>
          ) : previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : loading ? (
            <span className="flex h-full w-full items-center justify-center bg-muted/60">
              <Loader2 className="size-4 animate-spin text-muted-foreground/70" />
            </span>
          ) : itemKind === 'video' ? (
            <span className="flex h-full w-full items-center justify-center bg-muted/60">
              <Film className="size-4 text-muted-foreground/70" />
            </span>
          ) : (
            <span className="block size-full bg-muted/60" aria-hidden />
          )}
        </span>
      </button>

      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-[12px] ring-2 ring-muted-foreground/55 ring-inset"
        />
      )}

      {loading && previewFile && (
        <span className="pointer-events-none absolute inset-x-1 bottom-1 z-10 h-1 overflow-hidden rounded-full bg-black/10">
          <span className="block h-full w-5 animate-[creation-gallery-loading_1.2s_ease-in-out_infinite] rounded-full bg-foreground/70" />
        </span>
      )}

      <button
        type="button"
        aria-label={deleteLabel}
        className={creationClasses.historyDelete}
        onClick={(event) => {
          event.stopPropagation()
          onDelete(creation)
        }}>
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}

const CreationGallery: FC<CreationGalleryProps> = ({
  kind = 'image',
  selectedCreationId,
  runningCreationId,
  items,
  hasMore,
  loadMore,
  onDeleteCreation,
  onSelectCreation,
  onAddCreation
}) => {
  const { t } = useTranslation()
  const [pendingDelete, setPendingDelete] = useState<CreationGalleryEntry | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
    const target = event.currentTarget
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 120) {
      loadMore()
    }
  }

  useEffect(() => {
    const strip = stripRef.current
    if (hasMore && strip && strip.scrollHeight <= strip.clientHeight) {
      loadMore()
    }
  }, [hasMore, items.length, loadMore])

  return (
    <>
      <div ref={stripRef} className={creationClasses.historyStrip} onScroll={handleScroll}>
        <Tooltip
          content={kind === 'video' ? t('paintings.video.new') : t('paintings.button.new.image')}
          placement="left"
          delay={500}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={creationClasses.historyAddButton}
            aria-label={kind === 'video' ? t('paintings.video.new') : t('paintings.button.new.image')}
            onClick={onAddCreation}>
            <Plus className="size-4" />
          </Button>
        </Tooltip>
        {items.map((creation) => (
          <CreationGalleryItem
            key={creation.id}
            creation={creation}
            selected={creation.id === selectedCreationId}
            loading={creation.id === runningCreationId}
            onDelete={setPendingDelete}
            onSelect={onSelectCreation}
            selectLabel={creation.kind === 'video' ? t('paintings.video.title') : t('paintings.button.select.image')}
            deleteLabel={creation.kind === 'video' ? t('common.delete') : t('paintings.button.delete.image.label')}
          />
        ))}
        {hasMore && <Loader2 className="mx-auto size-4 shrink-0 animate-spin text-muted-foreground/60" aria-hidden />}
      </div>

      <style>{`
        @keyframes creation-gallery-loading {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(260%); }
        }
      `}</style>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null)
          }
        }}
        title={
          pendingDelete?.kind === 'video' ? t('common.delete_confirm') : t('paintings.button.delete.image.confirm')
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (pendingDelete) {
            onDeleteCreation(pendingDelete)
          }
          setPendingDelete(null)
        }}
      />
    </>
  )
}

export default CreationGallery
