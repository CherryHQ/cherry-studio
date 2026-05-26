import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { DraggableList } from '@renderer/components/DraggableList'
import Scrollbar from '@renderer/components/Scrollbar'
import { usePaintings } from '@renderer/hooks/usePaintings'
import FileManager from '@renderer/services/FileManager'
import type { Painting, PaintingsState } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { Popconfirm } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface PaintingsListProps {
  paintings: Painting[]
  selectedPainting: Painting
  onSelectPainting: (painting: Painting) => void
  onDeletePainting: (painting: Painting) => void
  onNewPainting: () => void
  namespace: keyof PaintingsState
}

const PaintingsList: FC<PaintingsListProps> = ({
  paintings,
  selectedPainting,
  onSelectPainting,
  onDeletePainting,
  onNewPainting,
  namespace
}) => {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)
  const { updatePaintings } = usePaintings()

  return (
    <Scrollbar
      className="flex h-[calc(100vh-var(--navbar-height))] max-w-25 flex-1 flex-col items-center gap-2.5 overflow-x-hidden bg-background p-2.5 [border-left:0.5px_solid_var(--color-border)]"
      style={{ paddingBottom: dragging ? 80 : 10 }}>
      {!dragging && (
        <div
          className="flex h-20 min-h-20 w-20 cursor-pointer items-center justify-center border border-border border-dashed bg-background-subtle text-foreground-secondary transition-colors duration-200 hover:border-primary hover:bg-muted hover:text-primary"
          onClick={onNewPainting}>
          <PlusOutlined />
        </div>
      )}
      <DraggableList
        list={paintings}
        onUpdate={(value) => updatePaintings(namespace, value)}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}>
        {(item: Painting) => (
          <div key={item.id} className="group relative">
            <div
              className={classNames(
                'relative h-20 w-20 cursor-pointer overflow-hidden bg-background-subtle transition-colors duration-200 hover:bg-muted',
                selectedPainting.id === item.id
                  ? 'border border-[var(--color-primary)]'
                  : 'border border-background-subtle'
              )}
              onClick={() => onSelectPainting(item)}>
              {item.files[0] && (
                <img src={FileManager.getFileUrl(item.files[0])} alt="" className="block h-full w-full object-cover" />
              )}
            </div>
            <div className="absolute top-1 right-1 flex cursor-pointer items-center justify-center rounded-full bg-background-subtle p-1 text-destructive opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Popconfirm
                title={t('paintings.button.delete.image.confirm')}
                onConfirm={() => onDeletePainting(item)}
                okButtonProps={{ danger: true }}
                placement="left">
                <DeleteOutlined />
              </Popconfirm>
            </div>
          </div>
        )}
      </DraggableList>
    </Scrollbar>
  )
}

export default PaintingsList
