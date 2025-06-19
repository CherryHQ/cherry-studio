import {
  DownloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SwapOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons'
import { triggerDownloadDialog } from '@renderer/utils/download'
import { Image as AntImage, ImageProps as AntImageProps, Space } from 'antd'
import React from 'react'
import styled from 'styled-components'

interface ImagePreviewProps extends AntImageProps {
  src: string
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ src, ...props }) => {
  return (
    <AntImage
      src={src}
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
          <ToobarWrapper size={12} className="toolbar-wrapper">
            <SwapOutlined rotate={90} onClick={onFlipY} />
            <SwapOutlined onClick={onFlipX} />
            <RotateLeftOutlined onClick={onRotateLeft} />
            <RotateRightOutlined onClick={onRotateRight} />
            <ZoomOutOutlined disabled={scale === 1} onClick={onZoomOut} />
            <ZoomInOutlined disabled={scale === 50} onClick={onZoomIn} />
            <UndoOutlined onClick={onReset} />
            <DownloadOutlined onClick={() => triggerDownloadDialog(src)} />
          </ToobarWrapper>
        )
      }}
    />
  )
}

const ToobarWrapper = styled(Space)`
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

export default ImagePreview
