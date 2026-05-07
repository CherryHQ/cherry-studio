import { useImageTools } from '@renderer/components/ActionTools/hooks/useImageTools'
import { LoadingIcon } from '@renderer/components/Icons'
import { memo, useImperativeHandle } from 'react'

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
  className?: string
}

const ImagePreviewLayout = ({
  children,
  ref,
  imageRef,
  source,
  loading,
  error,
  enableToolbar,
  className
}: ImagePreviewLayoutProps) => {
  // 使用通用图像工具
  const { pan, zoom, copy, download, dialog } = useImageTools(imageRef, {
    imgSelector: 'svg',
    prefix: source ?? 'svg',
    enableDrag: true,
    enableWheelZoom: true
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

  return (
    <PreviewContainer className={`image-preview-layout flex-col ${className ?? ''}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-background-opacity)]">
          <LoadingIcon color="var(--color-text-2)" />
        </div>
      )}
      {error && <PreviewError>{error}</PreviewError>}
      {children}
      {!error && enableToolbar && <ImageToolbar pan={pan} zoom={zoom} dialog={dialog} />}
    </PreviewContainer>
  )
}

export default memo(ImagePreviewLayout)
