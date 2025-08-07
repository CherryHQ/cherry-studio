import { ResetIcon } from '@renderer/components/Icons'
import { classNames } from '@renderer/utils'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
    <ToolbarWrapper className={classNames('preview-toolbar', className)} role="toolbar" aria-label={t('preview.label')}>
      {/* Up */}
      <ActionButtonRow>
        <Spacer />
        <ImageToolButton
          tooltip={t('preview.pan_up')}
          icon={<ChevronUp size={'1rem'} />}
          onClick={() => pan(0, -panDistance)}
        />
        <ImageToolButton tooltip={t('preview.dialog')} icon={<Scan size={'1rem'} />} onClick={dialog} />
      </ActionButtonRow>

      {/* Left, Reset, Right */}
      <ActionButtonRow>
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
      </ActionButtonRow>

      {/* Down, Zoom */}
      <ActionButtonRow>
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
      </ActionButtonRow>
    </ToolbarWrapper>
  )
}

const ToolbarWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  position: absolute;
  gap: 4px;
  right: 1em;
  bottom: 1em;
  z-index: 5;

  .ant-btn {
    line-height: 0;
  }
`

const ActionButtonRow = styled.div`
  display: flex;
  justify-content: center;
  gap: 4px;
  width: 100%;
`

const Spacer = styled.div`
  flex: 1;
`

export default memo(ImageToolbar)
