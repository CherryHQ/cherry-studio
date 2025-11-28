import {
  CopyOutlined,
  DownloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SwapOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons'
import { loggerService } from '@logger'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import store from '@renderer/store'
import { downloadImagesToFileStorage, triggerClientDownload } from '@renderer/utils/download'
import type { ImageProps as AntImageProps } from 'antd'
import { Dropdown, Image as AntImage, Space } from 'antd'
import { Base64 } from 'js-base64'
import { DownloadIcon, ImageIcon } from 'lucide-react'
import mime from 'mime'
import React, { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { CopyIcon } from './Icons'

interface ImageViewerProps extends AntImageProps {
  src: string
  onImageLocalized?: (localizedUrl: string, originalUrl: string) => Promise<void>
}

const logger = loggerService.withContext('ImageViewer')

const ImageViewer: React.FC<ImageViewerProps> = ({ src, style, onImageLocalized, ...props }) => {
  const { t } = useTranslation()
  const { autoLocalizeImages } = useSettings()
  const processedImageUrlsRef = useRef<Set<string>>(new Set())
  const filesPathRef = useRef(store.getState().runtime.filesPath)

  const localizeImage = useCallback(
    async (imageUrl: string) => {
      const processedImageUrls = processedImageUrlsRef.current
      if (processedImageUrls.has(imageUrl)) return
      processedImageUrls.add(imageUrl)

      const [downloadedFile] = await downloadImagesToFileStorage([imageUrl])

      if (downloadedFile?.path) {
        await FileManager.addFiles([downloadedFile])
        const localFileUrl = `http://file/${downloadedFile.name}`
        onImageLocalized?.(localFileUrl, imageUrl)
        processedImageUrls.delete(imageUrl)
      }
    },
    [onImageLocalized]
  )

  const imageSrc = src.startsWith('http://file/')
    ? `file://${filesPathRef.current}/${src.replace('http://file/', '')}`
    : src

  useEffect(() => {
    if (autoLocalizeImages && onImageLocalized && imageSrc.startsWith('http')) {
      localizeImage(imageSrc)
    }
  }, [imageSrc, autoLocalizeImages, localizeImage, onImageLocalized])

  // 复制图片到剪贴板
  const handleCopyImage = async (src: string) => {
    try {
      if (src.startsWith('data:')) {
        // 处理 base64 格式的图片
        const match = src.match(/^data:(image\/\w+);base64,(.+)$/)
        if (!match) throw new Error('Invalid base64 image format')
        const mimeType = match[1]
        const byteArray = Base64.toUint8Array(match[2])
        const blob = new Blob([byteArray], { type: mimeType })
        await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })])
      } else if (src.startsWith('file://')) {
        // 处理本地文件路径
        const bytes = await window.api.fs.read(src)
        const mimeType = mime.getType(src) || 'application/octet-stream'
        const blob = new Blob([bytes], { type: mimeType })
        await navigator.clipboard.write([
          new ClipboardItem({
            [mimeType]: blob
          })
        ])
      } else {
        // 处理 URL 格式的图片
        const response = await fetch(src)
        const blob = await response.blob()

        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob
          })
        ])
      }

      window.toast.success(t('message.copy.success'))
    } catch (error) {
      logger.error('Failed to copy image:', error as Error)
      window.toast.error(t('message.copy.failed'))
    }
  }

  const getContextMenuItems = (src: string, size: number = 14) => {
    return [
      {
        key: 'copy-url',
        label: t('common.copy'),
        icon: <CopyIcon size={size} />,
        onClick: () => {
          navigator.clipboard.writeText(src)
          window.toast.success(t('message.copy.success'))
        }
      },
      {
        key: 'download',
        label: t('common.download'),
        icon: <DownloadIcon size={size} />,
        onClick: () => triggerClientDownload(src)
      },
      {
        key: 'copy-image',
        label: t('preview.copy.image'),
        icon: <ImageIcon size={size} />,
        onClick: () => handleCopyImage(src)
      }
    ]
  }

  return (
    <Dropdown menu={{ items: getContextMenuItems(imageSrc) }} trigger={['contextMenu']}>
      <AntImage
        src={imageSrc}
        style={style}
        onContextMenu={(e) => e.stopPropagation()}
        {...props}
        preview={{
          mask: typeof props.preview === 'object' ? props.preview.mask : false,
          ...(typeof props.preview === 'object' ? props.preview : {}),
          toolbarRender: (
            _,
            {
              transform: { scale },
              actions: { onFlipY, onFlipX, onRotateLeft, onRotateRight, onZoomOut, onZoomIn, onReset }
            }
          ) => (
            <ToolbarWrapper size={12} className="toolbar-wrapper">
              <SwapOutlined rotate={90} onClick={onFlipY} />
              <SwapOutlined onClick={onFlipX} />
              <RotateLeftOutlined onClick={onRotateLeft} />
              <RotateRightOutlined onClick={onRotateRight} />
              <ZoomOutOutlined disabled={scale === 1} onClick={onZoomOut} />
              <ZoomInOutlined disabled={scale === 50} onClick={onZoomIn} />
              <UndoOutlined onClick={onReset} />
              <CopyOutlined onClick={() => handleCopyImage(imageSrc)} />
              <DownloadOutlined onClick={() => triggerClientDownload(imageSrc)} />
            </ToolbarWrapper>
          )
        }}
      />
    </Dropdown>
  )
}

const ToolbarWrapper = styled(Space)`
  padding: 0px 24px;
  color: #fff;
  font-size: 20px;
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 100px;
  .anticon {
    padding: 12px;
    cursor: pointer;
  }
  .anticon:hover {
    opacity: 0.3;
  }
`

export default ImageViewer
