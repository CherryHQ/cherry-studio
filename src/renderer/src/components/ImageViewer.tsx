import {
  CopyOutlined,
  DownloadOutlined,
  FileImageOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SwapOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import { downloadImagesToFileStorage, triggerDownloadDialog } from '@renderer/utils/download'
import { Dropdown, Image as AntImage, ImageProps as AntImageProps, Space } from 'antd'
import { Base64 } from 'js-base64'
import mime from 'mime'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const processedImageUrls = new Set<string>()

interface ImageViewerProps extends AntImageProps {
  src: string
  onImageLocalized?: (localizedUrl: string, originalUrl: string) => Promise<void>
}

const ImageViewer: React.FC<ImageViewerProps> = ({ src, style, onImageLocalized, ...props }) => {
  const { t } = useTranslation()
  const { autoLocalizeImages } = useSettings()

  const localizeImage = useCallback(
    async (imageUrl: string) => {
      if (processedImageUrls.has(imageUrl)) return
      processedImageUrls.add(imageUrl)

      const [downloadedFile] = await downloadImagesToFileStorage([imageUrl])

      if (downloadedFile?.path) {
        await FileManager.addFiles([downloadedFile])
        const localFileUrl = new URL(downloadedFile.path, 'file:').href
        onImageLocalized?.(localFileUrl, imageUrl)
      }
      processedImageUrls.delete(imageUrl)
    },
    [onImageLocalized]
  )

  useEffect(() => {
    if (autoLocalizeImages && src.startsWith('http') && onImageLocalized) {
      localizeImage(src)
    }
  }, [src, autoLocalizeImages, localizeImage, onImageLocalized])

  // 复制图片到剪贴板
  const handleCopyImage = async (src: string) => {
    try {
      if (src.startsWith('data:')) {
        // 处理 base64 格式的图片
        const match = src.match(/^data:(image\/\w+);base64,(.+)$/)
        if (!match) throw new Error('无效的 base64 图片格式')
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

      window.message.success(t('message.copy.success'))
    } catch (error) {
      console.error('复制图片失败:', error)
      window.message.error(t('message.copy.failed'))
    }
  }

  const getContextMenuItems = (src: string) => {
    return [
      {
        key: 'copy-url',
        label: t('common.copy'),
        icon: <CopyOutlined />,
        onClick: () => {
          navigator.clipboard.writeText(src)
          window.message.success(t('message.copy.success'))
        }
      },
      {
        key: 'download',
        label: t('common.download'),
        icon: <DownloadOutlined />,
        onClick: () => triggerDownloadDialog(src)
      },
      {
        key: 'copy-image',
        label: t('code_block.preview.copy.image'),
        icon: <FileImageOutlined />,
        onClick: () => handleCopyImage(src)
      }
    ]
  }

  return (
    <Dropdown menu={{ items: getContextMenuItems(src) }} trigger={['contextMenu']}>
      <AntImage
        src={src}
        style={style}
        {...props}
        preview={{
          mask: typeof props.preview === 'object' ? props.preview.mask : false,
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
              <CopyOutlined onClick={() => handleCopyImage(src)} />
              <DownloadOutlined onClick={() => triggerDownloadDialog(src)} />
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
