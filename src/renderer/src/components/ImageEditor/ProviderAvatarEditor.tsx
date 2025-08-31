import {
  CheckOutlined,
  CloseOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SwapOutlined,
  UndoOutlined
} from '@ant-design/icons'
import { loggerService } from '@logger'
import { VStack } from '@renderer/components/Layout'
import { Button, message, Modal, Space } from 'antd'
import React, { useCallback, useRef, useState } from 'react'
import Cropper, { ReactCropperElement } from 'react-cropper'
import styled from 'styled-components'

const logger = loggerService.withContext('ProviderAvatarEditor')

interface ProviderAvatarEditorProps {
  open: boolean
  imageSrc?: string
  onCancel: () => void
  onConfirm: (editedImage: Blob) => void
  title?: string
  aspectRatio?: number
  maxWidth?: number
  maxHeight?: number
}

const ProviderAvatarEditor: React.FC<ProviderAvatarEditorProps> = ({
  open,
  imageSrc,
  onCancel,
  onConfirm,
  title = '编辑头像',
  aspectRatio = 1, // 默认正方形
  maxWidth = 200,
  maxHeight = 200
}) => {
  const cropperRef = useRef<ReactCropperElement>(null)
  const [scaleX, setScaleX] = useState(1)
  const [scaleY, setScaleY] = useState(1)

  const resetTransforms = useCallback(() => {
    setScaleX(1)
    setScaleY(1)
    if (cropperRef.current?.cropper) {
      cropperRef.current.cropper.reset()
    }
  }, [])

  const handleRotateLeft = useCallback(() => {
    if (cropperRef.current?.cropper) {
      cropperRef.current.cropper.rotate(-90)
    }
  }, [])

  const handleRotateRight = useCallback(() => {
    if (cropperRef.current?.cropper) {
      cropperRef.current.cropper.rotate(90)
    }
  }, [])

  const handleFlipHorizontal = useCallback(() => {
    if (cropperRef.current?.cropper) {
      const newScaleX = scaleX * -1
      cropperRef.current.cropper.scaleX(newScaleX)
      setScaleX(newScaleX)
    }
  }, [scaleX])

  const handleFlipVertical = useCallback(() => {
    if (cropperRef.current?.cropper) {
      const newScaleY = scaleY * -1
      cropperRef.current.cropper.scaleY(newScaleY)
      setScaleY(newScaleY)
    }
  }, [scaleY])

  const handleConfirm = useCallback(async () => {
    if (!cropperRef.current?.cropper) {
      message.error('图片编辑器未准备就绪')
      return
    }

    try {
      const canvas = cropperRef.current.cropper.getCroppedCanvas({
        maxWidth,
        maxHeight,
        fillColor: '#ffffff',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      })

      canvas.toBlob(
        (blob) => {
          if (blob) {
            onConfirm(blob)
          } else {
            message.error('图片处理失败')
          }
        },
        'image/png',
        0.9
      )
    } catch (error) {
      logger.error('Image editing failed:', error as Error)
      message.error('图片编辑失败')
    }
  }, [maxWidth, maxHeight, onConfirm])

  const handleCancel = useCallback(() => {
    resetTransforms()
    onCancel()
  }, [onCancel, resetTransforms])

  if (!open || !imageSrc) {
    return null
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={handleCancel}
      width={600}
      footer={[
        <Button key="cancel" onClick={handleCancel} icon={<CloseOutlined />}>
          取消
        </Button>,
        <Button key="confirm" type="primary" onClick={handleConfirm} icon={<CheckOutlined />}>
          确认
        </Button>
      ]}
      destroyOnClose
      centered>
      <VStack gap="16px">
        {/* 图片裁剪区域 */}
        <CropperContainer>
          <Cropper
            ref={cropperRef}
            src={imageSrc}
            style={{ height: 400, width: '100%' }}
            aspectRatio={aspectRatio}
            guides={true}
            background={false}
            responsive={true}
            autoCropArea={0.9}
            initialAspectRatio={1}
            minCropBoxHeight={100}
            minCropBoxWidth={100}
            zoomable={true}
            movable={true}
            rotatable={true}
            scalable={true}
            checkOrientation={false}
            viewMode={1}
            dragMode="crop"
            cropBoxMovable={true}
            cropBoxResizable={true}
            toggleDragModeOnDblclick={false}
          />
        </CropperContainer>

        {/* 控制面板 */}
        <ControlPanel>
          <ControlSection>
            <SectionTitle>编辑工具</SectionTitle>
            <Space size="middle" wrap>
              <Button icon={<RotateLeftOutlined />} onClick={handleRotateLeft} size="small">
                左转
              </Button>
              <Button icon={<RotateRightOutlined />} onClick={handleRotateRight} size="small">
                右转
              </Button>
              <Button icon={<SwapOutlined />} onClick={handleFlipHorizontal} size="small">
                水平翻转
              </Button>
              <Button icon={<SwapOutlined rotate={90} />} onClick={handleFlipVertical} size="small">
                垂直翻转
              </Button>
              <Button icon={<UndoOutlined />} onClick={resetTransforms} size="small">
                重置
              </Button>
            </Space>
          </ControlSection>

          <TipText>
            💡 使用指南：
            <br />• 拖动图片进行移动和定位
            <br />• 拖动裁剪框角落调整裁剪区域大小
            <br />• 鼠标滚轮缩放图片
            <br />• 使用上方工具进行旋转和翻转
          </TipText>
        </ControlPanel>
      </VStack>
    </Modal>
  )
}

const CropperContainer = styled.div`
  /* Import and override cropper styles */
  .cropper-container {
    direction: ltr;
    font-size: 0;
    line-height: 0;
    position: relative;
    touch-action: none;
    user-select: none;
  }

  .cropper-container img {
    backface-visibility: hidden;
    display: block;
    height: 100%;
    image-orientation: 0deg;
    max-height: none;
    max-width: none;
    min-height: 0;
    min-width: 0;
    width: 100%;
  }

  .cropper-canvas,
  .cropper-crop-box,
  .cropper-drag-box,
  .cropper-modal,
  .cropper-wrap-box {
    bottom: 0;
    left: 0;
    position: absolute;
    right: 0;
    top: 0;
  }

  .cropper-wrap-box {
    overflow: hidden;
  }

  .cropper-drag-box {
    background: none;
    opacity: 0;
  }

  .cropper-modal {
    background: rgba(0, 0, 0, 0.5);
    opacity: 0.5;
  }

  .cropper-view-box {
    display: block;
    height: 100%;
    outline: 1px solid #39f;
    outline-color: rgba(51, 153, 255, 0.75);
    overflow: hidden;
    width: 100%;
    border-radius: 12px;
  }

  .cropper-dashed {
    border: 0 dashed #eee;
    display: block;
    opacity: 0.5;
    position: absolute;
  }

  .cropper-dashed.dashed-h {
    border-bottom-width: 1px;
    border-top-width: 1px;
    height: calc(100% / 3);
    left: 0;
    top: calc(100% / 3);
    width: 100%;
  }

  .cropper-dashed.dashed-v {
    border-left-width: 1px;
    border-right-width: 1px;
    height: 100%;
    left: calc(100% / 3);
    top: 0;
    width: calc(100% / 3);
  }

  .cropper-center {
    display: block;
    height: 0;
    left: 50%;
    opacity: 0.75;
    position: absolute;
    top: 50%;
    width: 0;
  }

  .cropper-center::before,
  .cropper-center::after {
    background: #eee;
    content: ' ';
    display: block;
    position: absolute;
  }

  .cropper-center::before {
    height: 1px;
    left: -3px;
    top: 0;
    width: 7px;
  }

  .cropper-center::after {
    height: 7px;
    left: 0;
    top: -3px;
    width: 1px;
  }

  .cropper-face,
  .cropper-line,
  .cropper-point {
    display: block;
    height: 100%;
    opacity: 0.1;
    position: absolute;
    width: 100%;
  }

  .cropper-face {
    background: #fff;
    left: 0;
    top: 0;
    border-radius: 12px;
  }

  .cropper-line {
    background: #39f;
  }

  .cropper-line.line-e {
    cursor: ew-resize;
    right: -3px;
    top: 0;
    width: 5px;
  }

  .cropper-line.line-n {
    cursor: ns-resize;
    height: 5px;
    left: 0;
    top: -3px;
  }

  .cropper-line.line-w {
    cursor: ew-resize;
    left: -3px;
    top: 0;
    width: 5px;
  }

  .cropper-line.line-s {
    bottom: -3px;
    cursor: ns-resize;
    height: 5px;
    left: 0;
  }

  .cropper-point {
    background: #39f;
    height: 5px;
    opacity: 0.75;
    width: 5px;
  }

  .cropper-point.point-e {
    cursor: ew-resize;
    margin-top: -3px;
    right: -3px;
    top: 50%;
  }

  .cropper-point.point-n {
    cursor: ns-resize;
    left: 50%;
    margin-left: -3px;
    top: -3px;
  }

  .cropper-point.point-w {
    cursor: ew-resize;
    left: -3px;
    margin-top: -3px;
    top: 50%;
  }

  .cropper-point.point-s {
    bottom: -3px;
    cursor: ns-resize;
    left: 50%;
    margin-left: -3px;
  }

  .cropper-point.point-ne {
    cursor: nesw-resize;
    right: -3px;
    top: -3px;
  }

  .cropper-point.point-nw {
    cursor: nwse-resize;
    left: -3px;
    top: -3px;
  }

  .cropper-point.point-sw {
    bottom: -3px;
    cursor: nesw-resize;
    left: -3px;
  }

  .cropper-point.point-se {
    bottom: -3px;
    cursor: nwse-resize;
    right: -3px;
  }

  .cropper-crop-box {
    border-radius: 12px;
  }

  @media (min-width: 768px) {
    .cropper-point.point-se {
      height: 15px;
      width: 15px;
    }
  }

  @media (min-width: 992px) {
    .cropper-point.point-se {
      height: 20px;
      width: 20px;
    }
  }

  .cropper-invisible {
    opacity: 0;
  }

  .cropper-bg {
    background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAAA3NCSVQICAjb4U/gAAAABlBMVEXMzMz////TjRV2AAAACXBIWXMAAArrAAAK6wGCiw1aAAAAHHRFWHRTb2Z0d2FyZQBBZG9iZSBGaXJld29ya3MgQ1M26LyyjAAAAA5JREFUCJlj+M/AgBVhF/0L2s8miZMYQKiTPE++zWEYhQZGr8Gr8QmjO/Hn7aswNBZfQJ5TU2qsQGiYJqcD4YJnJNQ7KCRhvSuBAT2gOhEH9NjJ5jR8Tr7fZYgH');
  }

  .cropper-hide {
    display: block;
    height: 0;
    position: absolute;
    width: 0;
  }

  .cropper-hidden {
    display: none;
  }

  .cropper-move {
    cursor: move;
  }

  .cropper-crop {
    cursor: crosshair;
  }

  .cropper-disabled .cropper-drag-box,
  .cropper-disabled .cropper-face,
  .cropper-disabled .cropper-line,
  .cropper-disabled .cropper-point {
    cursor: not-allowed;
  }
`

const ControlPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--color-background-soft);
  border-radius: 8px;
`

const ControlSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.h4`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
`

const TipText = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  margin-top: 4px;
`

export default ProviderAvatarEditor
