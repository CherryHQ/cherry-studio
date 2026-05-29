import { ResetIcon } from '@renderer/components/Icons'
import { classNames } from '@renderer/utils'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import ImageToolButton from './ImageToolButton'

interface ImageToolbarProps {
  pan: (dx: number, dy: number, absolute?: boolean) => void
  zoom: (delta: number, absolute?: boolean) => void
  dialog: () => void
  className?: string
}

const ImageToolbar = ({ pan, zoom, dialog, className }: ImageToolbarProps) => {
  const { t } = useTranslation()

  // 定义平移距离
  const panDistance = 20

  // 定义缩放增量
  const zoomDelta = 0.1

  const handleReset = useCallback(() => {
    pan(0, 0, true)
    zoom(1, true)
  }, [pan, zoom])

  return (
    <div
      className={classNames(
        'preview-toolbar absolute right-[1em] bottom-[1em] z-[5] flex flex-col items-center gap-1 [&_.ant-btn]:leading-[0]',
        className
      )}
      role="toolbar"
      aria-label={t('preview.label')}>
      {/* Up */}
      <div className="flex w-full justify-center gap-1">
        <div className="flex-1" />
        <ImageToolButton
          tooltip={t('preview.pan_up')}
          icon={<ChevronUp size={'1rem'} />}
          onClick={() => pan(0, -panDistance)}
        />
        <ImageToolButton tooltip={t('preview.dialog')} icon={<Scan size={'1rem'} />} onClick={dialog} />
      </div>

      {/* Left, Reset, Right */}
      <div className="flex w-full justify-center gap-1">
        <ImageToolButton
          tooltip={t('preview.pan_left')}
          icon={<ChevronLeft size={'1rem'} />}
          onClick={() => pan(-panDistance, 0)}
        />
        <ImageToolButton tooltip={t('preview.reset')} icon={<ResetIcon size={'1rem'} />} onClick={handleReset} />
        <ImageToolButton
          tooltip={t('preview.pan_right')}
          icon={<ChevronRight size={'1rem'} />}
          onClick={() => pan(panDistance, 0)}
        />
      </div>

      {/* Down, Zoom */}
      <div className="flex w-full justify-center gap-1">
        <ImageToolButton
          tooltip={t('preview.zoom_out')}
          icon={<ZoomOut size={'1rem'} />}
          onClick={() => zoom(-zoomDelta)}
        />
        <ImageToolButton
          tooltip={t('preview.pan_down')}
          icon={<ChevronDown size={'1rem'} />}
          onClick={() => pan(0, panDistance)}
        />
        <ImageToolButton
          tooltip={t('preview.zoom_in')}
          icon={<ZoomIn size={'1rem'} />}
          onClick={() => zoom(zoomDelta)}
        />
      </div>
    </div>
  )
}

export default memo(ImageToolbar)
