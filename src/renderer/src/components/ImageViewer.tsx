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
import { download } from '@renderer/utils/download'
import { convertImageToPng } from '@renderer/utils/image'
import type { ImageProps as AntImageProps } from 'antd'
import { Dropdown, Image as AntImage, Space } from 'antd'
import { Base64 } from 'js-base64'
import { DownloadIcon, ImageIcon } from 'lucide-react'
import mime from 'mime'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { CopyIcon } from './Icons'

interface ImageViewerProps extends AntImageProps {
  src: string
}

const logger = loggerService.withContext('ImageViewer')

const ImageViewer: React.FC<ImageViewerProps> = ({ src, style, ...props }) => {
  const { t } = useTranslation()

  // 复制图片到剪贴板
  const handleCopyImage = async (src: string) => {
    try {
      let blob: Blob

      if (src.startsWith('data:')) {
        // 处理 base64 格式的图片
        const match = src.match(/^data:(image\/\w+);base64,(.+)$/)
        if (!match) throw new Error('Invalid base64 image format')
        const mimeType = match[1]
        const byteArray = Base64.toUint8Array(match[2])
        blob = new Blob([byteArray], { type: mimeType })
      } else if (src.startsWith('file://')) {
        // 处理本地文件路径
        const bytes = await window.api.fs.read(src)
        const mimeType = mime.getType(src) || 'application/octet-stream'
        blob = new Blob([bytes], { type: mimeType })
      } else {
        // 处理 URL 格式的图片
        const response = await fetch(src)
        blob = await response.blob()
      }

      // 统一转换为 PNG 以确保兼容性（剪贴板 API 不支持 JPEG）
      const pngBlob = await convertImageToPng(blob)

      const item = new ClipboardItem({
        'image/png': pngBlob
      })
      await navigator.clipboard.write([item])

      window.toast.success(t('message.copy.success'))
    } catch (error) {
      const err = error as Error
      logger.error(`Failed to copy image: ${err.message}`, { stack: err.stack })
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
        onClick: () => download(src)
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
    <Dropdown menu={{ items: getContextMenuItems(src) }} trigger={['contextMenu']}>
      <AntImage
        src={src}
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
              <CopyOutlined onClick={() => handleCopyImage(src)} />
              <DownloadOutlined onClick={() => download(src)} />
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
