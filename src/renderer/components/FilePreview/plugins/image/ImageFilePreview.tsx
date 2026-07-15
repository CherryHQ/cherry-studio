import { Button, EmptyState, ImagePreviewImage, Tooltip, useImagePreviewTransform } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { getFilePreviewExtension } from '@renderer/utils/filePreview'
import { toSafeFileUrl } from '@shared/utils/file'
import {
  FlipHorizontal,
  FlipVertical,
  ImageOff,
  LoaderCircle,
  RotateCcw,
  RotateCw,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { FilePreviewToolbar } from '../../FilePreviewToolbar'
import type { FilePreviewPluginProps } from '../../types'

const logger = loggerService.withContext('ImageFilePreview')

interface ImageToolbarButtonProps {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}

function ImageToolbarButton({ children, disabled, label, onClick }: ImageToolbarButtonProps) {
  return (
    <Tooltip content={label} delay={300}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="text-muted-foreground hover:text-foreground">
        {children}
      </Button>
    </Tooltip>
  )
}

export default function ImageFilePreview({ filePath, fileName }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'error' | 'loading' | 'ready'>('loading')
  const transformControls = useImagePreviewTransform()
  const item = useMemo(
    () => ({
      id: filePath,
      src: toSafeFileUrl(filePath, getFilePreviewExtension(filePath)),
      alt: fileName,
      title: fileName
    }),
    [fileName, filePath]
  )

  if (status === 'error') {
    return (
      <FilePreviewLayout.Frame>
        <FilePreviewLayout.Content>
          <div role="alert" className="h-full">
            <EmptyState
              icon={ImageOff}
              title={t('file_preview.load_error.title')}
              description={t('file_preview.load_error.description')}
              className="h-full"
            />
          </div>
        </FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )
  }

  return (
    <FilePreviewLayout.Frame>
      <FilePreviewToolbar aria-label={t('preview.label')}>
        <ImageToolbarButton
          label={t('preview.zoom_out')}
          disabled={status !== 'ready' || !transformControls.canZoomOut}
          onClick={transformControls.zoomOut}>
          <ZoomOut aria-hidden />
        </ImageToolbarButton>
        <ImageToolbarButton
          label={t('preview.zoom_in')}
          disabled={status !== 'ready' || !transformControls.canZoomIn}
          onClick={transformControls.zoomIn}>
          <ZoomIn aria-hidden />
        </ImageToolbarButton>
        <ImageToolbarButton
          label={t('preview.rotate_left')}
          disabled={status !== 'ready'}
          onClick={transformControls.rotateLeft}>
          <RotateCcw aria-hidden />
        </ImageToolbarButton>
        <ImageToolbarButton
          label={t('preview.rotate_right')}
          disabled={status !== 'ready'}
          onClick={transformControls.rotateRight}>
          <RotateCw aria-hidden />
        </ImageToolbarButton>
        <ImageToolbarButton
          label={t('preview.flip_horizontal')}
          disabled={status !== 'ready'}
          onClick={transformControls.flipHorizontal}>
          <FlipHorizontal aria-hidden />
        </ImageToolbarButton>
        <ImageToolbarButton
          label={t('preview.flip_vertical')}
          disabled={status !== 'ready'}
          onClick={transformControls.flipVertical}>
          <FlipVertical aria-hidden />
        </ImageToolbarButton>
        <ImageToolbarButton label={t('preview.reset')} disabled={status !== 'ready'} onClick={transformControls.reset}>
          <Undo2 aria-hidden />
        </ImageToolbarButton>
      </FilePreviewToolbar>
      <FilePreviewLayout.Content>
        <div className="relative flex h-full min-h-full min-w-full items-center justify-center p-4">
          {status === 'loading' && (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <span>{t('file_preview.loading')}</span>
            </div>
          )}
          <ImagePreviewImage
            className={status === 'loading' ? 'opacity-0' : undefined}
            item={item}
            transform={transformControls.transform}
            onLoad={() => setStatus('ready')}
            onError={() => {
              const error = new Error(`Failed to load image preview: ${filePath}`)
              logger.error(`Failed to load image preview: ${filePath}`, error)
              setStatus('error')
            }}
          />
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
