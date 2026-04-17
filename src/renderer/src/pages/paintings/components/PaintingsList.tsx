import { ConfirmDialog } from '@cherrystudio/ui'
import { DraggableList } from '@renderer/components/DraggableList'
import FileManager from '@renderer/services/FileManager'
import { Plus, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isPaintingLoading, usePaintingRuntime } from '../model/runtime/paintingRuntimeStore'
import type { PaintingData } from '../model/types/paintingData'

interface PaintingsListProps {
  paintings: PaintingData[]
  selectedPainting: PaintingData
  onSelectPainting: (painting: PaintingData) => void
  onDeletePainting: (painting: PaintingData) => void
  onNewPainting: () => void
  onReorder: (paintings: PaintingData[]) => void
}

interface PaintingListItemProps {
  painting: PaintingData
  selected: boolean
  onSelect: (painting: PaintingData) => void
  onDelete: (painting: PaintingData) => void
}

const PaintingListItem: FC<PaintingListItemProps> = ({ painting, selected, onSelect, onDelete }) => {
  const [runtimeState] = usePaintingRuntime(painting.id)
  const loading = isPaintingLoading(painting, runtimeState)

  return (
    <div className="group relative w-[76px] shrink-0">
      <button
        type="button"
        className={`relative h-[76px] w-[76px] overflow-hidden rounded-[0.75rem] border transition-all ${
          selected ? 'border-primary ring-2 ring-primary/25' : 'border-transparent bg-muted/30 hover:bg-muted/45'
        }`}
        onClick={() => onSelect(painting)}>
        {painting.files[0] ? (
          <img src={FileManager.getFileUrl(painting.files[0])} alt="" className="block h-full w-full object-cover" />
        ) : (
          <span className="block h-full w-full bg-muted/20" aria-hidden />
        )}

        {loading && (
          <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-1 overflow-hidden bg-black/8">
            <div className="h-full w-8 animate-[painting-list-loading_1.2s_ease-in-out_infinite] rounded-full bg-primary/75" />
          </div>
        )}
      </button>

      <button
        type="button"
        onClick={() => onDelete(painting)}
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border border-border/60 bg-background/90 text-destructive opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100">
        <Trash2 size={12} />
      </button>
    </div>
  )
}

const PaintingsList: FC<PaintingsListProps> = ({
  paintings,
  selectedPainting,
  onSelectPainting,
  onDeletePainting,
  onNewPainting,
  onReorder
}) => {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PaintingData | null>(null)

  return (
    <>
      <div
        className="flex h-[calc(100vh-var(--navbar-height))] max-w-[108px] shrink-0 flex-col items-center gap-2.5 overflow-y-auto overflow-x-hidden border-border border-l bg-muted/15 p-2.5"
        style={{ paddingBottom: dragging ? 80 : 12 }}>
        {!dragging && (
          <button
            type="button"
            onClick={onNewPainting}
            className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-[0.75rem] border border-border/80 border-dashed bg-muted/25 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 hover:text-primary">
            <Plus size={18} strokeWidth={1.75} />
          </button>
        )}

        <DraggableList
          list={paintings}
          onUpdate={(value) => onReorder(value)}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}>
          {(item: PaintingData) => (
            <PaintingListItem
              key={item.id}
              painting={item}
              selected={selectedPainting.id === item.id}
              onSelect={onSelectPainting}
              onDelete={setPendingDelete}
            />
          )}
        </DraggableList>
      </div>

      <style>{`
        @keyframes painting-list-loading {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(320%); }
        }
      `}</style>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
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

export default PaintingsList
