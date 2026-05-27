import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { DraggableList } from '@renderer/components/DraggableList'
import Scrollbar from '@renderer/components/Scrollbar'
import { usePaintings } from '@renderer/hooks/usePaintings'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import { classNames } from '@renderer/utils'
import type { FileEntry } from '@shared/data/types/file'
import { Popconfirm } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getPaintingFileUrl } from '../utils/imageFiles'

const logger = loggerService.withContext('PaintingsList')

interface PaintingsListProps<T extends PaintingAction = PaintingAction> {
  paintings: T[]
  selectedPainting: T
  onSelectPainting: (painting: T) => void
  onDeletePainting: (painting: T) => void
  onNewPainting: () => void
  namespace: keyof PaintingsState
}

const PaintingThumbnail = ({ file }: { file?: FileEntry }) => {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let active = true

    if (!file) {
      setUrl('')
      return
    }

    getPaintingFileUrl(file)
      .then((value) => {
        if (active) setUrl(value)
      })
      .catch((error) => {
        logger.error('Failed to resolve painting thumbnail URL', error as Error)
        if (active) setUrl('')
      })

    return () => {
      active = false
    }
  }, [file])

  return url ? <img src={url} alt="" className="block h-full w-full object-cover" /> : null
}

const PaintingsList = <T extends PaintingAction>({
  paintings,
  selectedPainting,
  onSelectPainting,
  onDeletePainting,
  onNewPainting,
  namespace
}: PaintingsListProps<T>) => {
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
        {(item: T) => (
          <div key={item.id} className="group relative">
            <div
              className={classNames(
                'relative h-20 w-20 cursor-pointer overflow-hidden bg-background-subtle transition-colors duration-200 hover:bg-muted',
                selectedPainting.id === item.id
                  ? 'border border-[var(--color-primary)]'
                  : 'border border-background-subtle'
              )}
              onClick={() => onSelectPainting(item)}>
              <PaintingThumbnail file={item.files[0]} />
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
