import { useImageTools } from '@renderer/components/ActionTools/hooks/useImageTools'
import { LoadingIcon } from '@renderer/components/Icons'
import { Spin } from 'antd'
import { memo, useImperativeHandle } from 'react'

import ImageToolbar from './ImageToolbar'
import { PreviewContainer, PreviewError } from './styles'
import { BasicPreviewHandles } from './types'

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
    <Spin spinning={loading} indicator={<LoadingIcon color="var(--color-text-2)" />}>
      <PreviewContainer vertical className={`image-preview-layout ${className ?? ''}`}>
        {error && <PreviewError>{error}</PreviewError>}
        {children}
        {!error && enableToolbar && <ImageToolbar pan={pan} zoom={zoom} dialog={dialog} />}
      </PreviewContainer>
    </Spin>
  )
}

export default memo(ImagePreviewLayout)
