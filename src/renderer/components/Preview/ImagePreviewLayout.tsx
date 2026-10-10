import { memo, useImperativeHandle } from 'react'

import { useImageTools } from '@renderer/components/ActionTools'
import LoadingIcon from '@renderer/components/icons/LoadingIcon'

import ImageToolbar from './ImageToolbar'
import { PreviewContainer, PreviewError } from './styles'
import type { BasicPreviewHandles } from './types'

interface ImagePreviewLayoutProps {
  children: React.ReactNode
  ref?: React.RefObject<BasicPreviewHandles | null>
  imageRef: React.RefObject<HTMLDivElement | null>
  source: string
  loading?: boolean
  error?: string | null
  enableToolbar?: boolean
  enableDrag?: boolean
  enableWheelZoom?: boolean
  className?: string
}

const IMAGE_PREVIEW_LOADING_COLOR = 'var(--muted-foreground)'

const ImagePreviewLayout = ({
  children,
  ref,
  imageRef,
  source,
  loading,
  error,
  enableToolbar,
  enableDrag = true,
  enableWheelZoom = true,
  className
}: ImagePreviewLayoutProps) => {
  // 使用通用图像工具
  const { pan, zoom, copy, download, dialog } = useImageTools(imageRef, {
    imgSelector: 'svg',
    prefix: source ?? 'svg',
    enableDrag,
    enableWheelZoom
  })

  useImperativeHandle(ref, () => {
    return {
      pan,
      zoom,
      copy,
      download,
      dialog
    }
  })

  const enablePanZoom = enableDrag || enableWheelZoom

  return (
    <PreviewContainer className={`image-preview-layout flex-col ${className ?? ''}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background-subtle">
          <LoadingIcon color={IMAGE_PREVIEW_LOADING_COLOR} />
        </div>
      )}
      {error && <PreviewError>{error}</PreviewError>}
      {children}
      {!error && enableToolbar && <ImageToolbar pan={pan} zoom={zoom} dialog={dialog} enablePanZoom={enablePanZoom} />}
    </PreviewContainer>
  )
}

export default memo(ImagePreviewLayout)
