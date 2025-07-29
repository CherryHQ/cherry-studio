import { useImageTools } from '@renderer/components/ActionTools/hooks/useImageTools'
import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
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
}

const ImagePreviewLayout = ({
  children,
  ref,
  imageRef,
  source,
  loading,
  error,
  enableToolbar
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
    <Spin spinning={loading} indicator={<SvgSpinners180Ring color="var(--color-text-2)" />}>
      <PreviewContainer vertical>
        {error && <PreviewError>{error}</PreviewError>}
        {children}
        {!error && enableToolbar && <ImageToolbar pan={pan} zoom={zoom} dialog={dialog} />}
      </PreviewContainer>
    </Spin>
  )
}

export default memo(ImagePreviewLayout)
