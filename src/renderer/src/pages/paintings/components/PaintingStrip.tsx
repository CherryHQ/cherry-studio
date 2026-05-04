import { Button, ConfirmDialog, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import FileManager from '@renderer/services/FileManager'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type PaintingStripEntry, usePaintingItems } from '../hooks/usePaintingItems'
import type { PaintingData } from '../model/types/paintingData'
import { paintingClasses } from '../PaintingPrimitives'

interface PaintingStripProps {
  selectedPaintingId?: string
  onDeletePainting: (painting: PaintingData) => void
  onSelectPainting: (painting: PaintingData) => void
  onAddPainting: () => void
}

const PaintingStripItem: FC<{
  painting: PaintingStripEntry
  selected: boolean
  loading: boolean
  onDelete: (painting: PaintingStripEntry) => void
  onSelect: (painting: PaintingStripEntry) => void
}> = ({ painting, selected, loading, onDelete, onSelect }) => {
  const previewFile = painting.files?.[0]

  return (
    <button
      type="button"
      className={cn(paintingClasses.historyItem, selected && paintingClasses.historyItemActive)}
      onClick={() => onSelect(painting)}>
      <span className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[16px]">
        {previewFile ? (
          <img src={FileManager.getFileUrl(previewFile)} alt="" className="h-full w-full object-cover" />
        ) : loading ? (
          <span className="flex h-full w-full items-center justify-center bg-muted/60">
            <Loader2 className="size-4 animate-spin text-muted-foreground/70" />
          </span>
        ) : (
          <span className="block size-full bg-muted/60" aria-hidden />
        )}
      </span>

      {loading && previewFile && (
        <span className="pointer-events-none absolute inset-x-1 bottom-1 z-10 h-1 overflow-hidden rounded-full bg-black/10">
          <span className="block h-full w-5 animate-[painting-history-loading_1.2s_ease-in-out_infinite] rounded-full bg-foreground/70" />
        </span>
      )}

      <span
        className={paintingClasses.historyDelete}
        onClick={(event) => {
          event.stopPropagation()
          onDelete(painting)
        }}>
        <Trash2 className="size-3" />
      </span>
    </button>
  )
}

const PaintingStrip: FC<PaintingStripProps> = ({
  selectedPaintingId,
  onDeletePainting,
  onSelectPainting,
  onAddPainting
}) => {
  const { t } = useTranslation()
  const { items } = usePaintingItems()
  const [pendingDelete, setPendingDelete] = useState<PaintingStripEntry | null>(null)

  return (
    <>
      <div className={paintingClasses.historyStrip}>
        <Tooltip content={t('paintings.button.new.image')} placement="left" delay={500}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={paintingClasses.historyAddButton}
            aria-label={t('paintings.button.new.image')}
            onClick={onAddPainting}>
            <Plus className="size-4" />
          </Button>
        </Tooltip>
        {items.map((painting) => (
          <PaintingStripItem
            key={painting.id}
            painting={painting}
            selected={painting.id === selectedPaintingId}
            loading={painting.generationStatus === 'running'}
            onDelete={setPendingDelete}
            onSelect={onSelectPainting}
          />
        ))}
      </div>

      <style>{`
        @keyframes painting-history-loading {
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
        title={t('paintings.button.delete.image.confirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (pendingDelete) {
            onDeletePainting(pendingDelete)
          }
          setPendingDelete(null)
        }}
      />
    </>
  )
}

export default PaintingStrip
