import { ConfirmDialog } from '@cherrystudio/ui'
import { DraggableList } from '@renderer/components/DraggableList'
import FileManager from '@renderer/services/FileManager'
import type { Painting } from '@renderer/types'
import { Plus, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface PaintingsListProps {
  paintings: Painting[]
  selectedPainting: Painting
  onSelectPainting: (painting: Painting) => void
  onDeletePainting: (painting: Painting) => void
  onNewPainting: () => void
  onReorder: (paintings: Painting[]) => void
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
  const [pendingDelete, setPendingDelete] = useState<Painting | null>(null)

  return (
    <>
      <div
        className="flex h-[calc(100vh-var(--navbar-height))] max-w-[100px] flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-background)] p-2"
        style={{ paddingBottom: dragging ? 80 : 10 }}>
        {!dragging && (
          <button
            type="button"
            onClick={onNewPainting}
            className="flex h-20 min-h-20 w-20 items-center justify-center border border-dashed border-[var(--color-border)] bg-[var(--color-background-soft)] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-background-mute)] hover:text-[var(--color-primary)]">
            <Plus size={18} />
          </button>
        )}

        <DraggableList
          list={paintings}
          onUpdate={(value) => onReorder(value)}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}>
          {(item: Painting) => (
            <div key={item.id} className="group relative">
              <button
                type="button"
                className={`relative h-20 w-20 overflow-hidden border transition-colors ${
                  selectedPainting.id === item.id
                    ? 'border-[var(--color-primary)]'
                    : 'border-[var(--color-background-soft)] bg-[var(--color-background-soft)] hover:bg-[var(--color-background-mute)]'
                }`}
                onClick={() => onSelectPainting(item)}>
                {item.files[0] && (
                  <img
                    src={FileManager.getFileUrl(item.files[0])}
                    alt=""
                    className="block h-full w-full object-cover"
                  />
                )}
              </button>

              <button
                type="button"
                onClick={() => setPendingDelete(item)}
                className="absolute right-1 top-1 flex items-center justify-center rounded-full bg-[var(--color-background-soft)] p-1 text-[var(--color-error)] opacity-0 transition-opacity group-hover:opacity-100">
                <Trash2 size={14} />
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
