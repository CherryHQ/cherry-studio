import { memo, useEffect, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'

import { useImageTools } from '@renderer/components/ActionTools'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ErrorNotice } from '@renderer/components/ErrorNotice'
import LoadingIcon from '@renderer/components/icons/LoadingIcon'

import ImageToolbar from './ImageToolbar'
import { PreviewContainer } from './styles'
import type { BasicPreviewHandles } from './types'

interface ImagePreviewLayoutProps {
  children: React.ReactNode
  ref?: React.RefObject<BasicPreviewHandles | null>
  imageRef: React.RefObject<HTMLDivElement | null>
  source: string
  loading?: boolean
  error?: string | null
  cause?: unknown | null
  enableToolbar?: boolean
  onErrorChange?: (failed: boolean) => void
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
  cause,
  enableToolbar,
  onErrorChange,
  enableDrag = true,
  enableWheelZoom = true,
  className
}: ImagePreviewLayoutProps) => {
  const { t } = useTranslation()
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

  const failed = Boolean(error)
  useEffect(() => {
    onErrorChange?.(failed)
  }, [failed, onErrorChange])

  const enablePanZoom = enableDrag || enableWheelZoom

  return (
    // Contain the overlays' z-index so a host toolbar drawn over the preview (Notes code block) stays clickable.
    <PreviewContainer className={`image-preview-layout isolate flex-col ${className ?? ''}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background-subtle">
          <LoadingIcon color={IMAGE_PREVIEW_LOADING_COLOR} />
        </div>
      )}
      {error && (
        <ErrorNotice
          variant="inline"
          className="absolute inset-0 z-10 items-center"
          title={t('preview.render.failed')}
          detail={
            cause != null ? (
              <ErrorDetailAction
                error={cause}
                message={t('preview.render.failed')}
                source="preview"
                operation="preview.render"
              />
            ) : undefined
          }
        />
      )}
      {children}
      {!error && enableToolbar && <ImageToolbar pan={pan} zoom={zoom} dialog={dialog} enablePanZoom={enablePanZoom} />}
    </PreviewContainer>
  )
}

export default memo(ImagePreviewLayout)
