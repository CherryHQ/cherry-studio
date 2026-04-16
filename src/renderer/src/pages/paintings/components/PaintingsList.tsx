import { ConfirmDialog } from '@cherrystudio/ui'
import { DraggableList } from '@renderer/components/DraggableList'
import FileManager from '@renderer/services/FileManager'
import type { PaintingCanvas } from '@renderer/types'
import { Plus, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface PaintingsListProps {
  paintings: PaintingCanvas[]
  selectedPainting: PaintingCanvas
  onSelectPainting: (painting: PaintingCanvas) => void
  onDeletePainting: (painting: PaintingCanvas) => void
  onNewPainting: () => void
  onReorder: (paintings: PaintingCanvas[]) => void
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
  const [pendingDelete, setPendingDelete] = useState<PaintingCanvas | null>(null)

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
          {(item: PaintingCanvas) => (
            <div key={item.id} className="group relative w-[76px] shrink-0">
              <button
                type="button"
                className={`relative h-[76px] w-[76px] overflow-hidden rounded-[0.75rem] border transition-all ${
                  selectedPainting.id === item.id
                    ? 'border-primary ring-2 ring-primary/25'
                    : 'border-transparent bg-muted/30 hover:bg-muted/45'
                }`}
                onClick={() => onSelectPainting(item)}>
                {item.files[0] ? (
                  <img
                    src={FileManager.getFileUrl(item.files[0])}
                    alt=""
                    className="block h-full w-full object-cover"
                  />
                ) : (
                  <span className="block h-full w-full bg-muted/20" aria-hidden />
                )}
              </button>

              <button
                type="button"
                onClick={() => setPendingDelete(item)}
                className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border border-border/60 bg-background/90 text-destructive opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100">
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </DraggableList>
      </div>

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
