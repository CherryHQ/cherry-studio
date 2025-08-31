import {
  CheckOutlined,
  CloseOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SwapOutlined,
  UndoOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { loggerService } from '@logger'
import { Center, VStack } from '@renderer/components/Layout'
import { Button, message, Modal, Slider, Space, Upload } from 'antd'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import Cropper, { ReactCropperElement } from 'react-cropper'
// import { useTranslation } from 'react-i18next' // 暂时不使用翻译
import styled from 'styled-components'

const logger = loggerService.withContext('ImageEditor')

interface ImageEditorProps {
  open: boolean
  imageSrc?: string
  onCancel: () => void
  onConfirm: (editedImage: Blob) => void
  title?: string
  aspectRatio?: number
  maxWidth?: number
  maxHeight?: number
}

const ImageEditor: React.FC<ImageEditorProps> = ({
  open,
  imageSrc,
  onCancel,
  onConfirm,
  title = '编辑图片',
  aspectRatio = 1, // 默认正方形
  maxWidth = 300,
  maxHeight = 300
}) => {
  // const { t } = useTranslation() // 暂时注释掉，后续可能会用到
  const cropperRef = useRef<ReactCropperElement>(null)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [saturation, setSaturation] = useState(100)
  // const [rotation, setRotation] = useState(0) // 保留用于未来功能扩展
  const [scaleX, setScaleX] = useState(1)
  const [scaleY, setScaleY] = useState(1)
  const [currentImage, setCurrentImage] = useState(imageSrc)

  useEffect(() => {
    setCurrentImage(imageSrc)
  }, [imageSrc])

  const resetFilters = useCallback(() => {
    setBrightness(100)
    setContrast(100)
    setSaturation(100)
    // setRotation(0) // 由 cropper 内部处理
    setScaleX(1)
    setScaleY(1)
    if (cropperRef.current?.cropper) {
      cropperRef.current.cropper.reset()
    }
  }, [])

  const handleRotateLeft = useCallback(() => {
    if (cropperRef.current?.cropper) {
      cropperRef.current.cropper.rotate(-90)
      // setRotation((prev) => prev - 90) // 暂时注释，cropper 内部处理旋转
    }
  }, [])

  const handleRotateRight = useCallback(() => {
    if (cropperRef.current?.cropper) {
      cropperRef.current.cropper.rotate(90)
      // setRotation((prev) => prev + 90) // 暂时注释，cropper 内部处理旋转
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

  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setCurrentImage(e.target?.result as string)
    }
    reader.readAsDataURL(file)
    return false // 阻止默认上传行为
  }, [])

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

      // 应用滤镜效果
      const ctx = canvas.getContext('2d')
      if (ctx && (brightness !== 100 || contrast !== 100 || saturation !== 100)) {
        ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`
        ctx.globalCompositeOperation = 'source-over'
        ctx.drawImage(canvas, 0, 0)
      }

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
  }, [brightness, contrast, saturation, maxWidth, maxHeight, onConfirm])

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      width={800}
      footer={[
        <Button key="cancel" onClick={onCancel} icon={<CloseOutlined />}>
          取消
        </Button>,
        <Button key="confirm" type="primary" onClick={handleConfirm} icon={<CheckOutlined />}>
          确认
        </Button>
      ]}
      destroyOnClose
      centered>
      <VStack gap="16px">
        {/* 图片上传区域 */}
        {!currentImage && (
          <Center>
            <Upload.Dragger
              accept="image/*"
              beforeUpload={handleFileUpload}
              showUploadList={false}
              style={{ width: '100%', minHeight: 200 }}>
              <p className="ant-upload-drag-icon">
                <UploadOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽图片到这里上传</p>
              <p className="ant-upload-hint">支持 JPG、PNG、GIF 格式</p>
            </Upload.Dragger>
          </Center>
        )}

        {/* 图片编辑区域 */}
        {currentImage && (
          <>
            <CropperContainer>
              <Cropper
                ref={cropperRef}
                src={currentImage}
                style={{ height: 400, width: '100%' }}
                aspectRatio={aspectRatio}
                guides={true}
                background={false}
                responsive={true}
                autoCropArea={0.8}
                checkOrientation={false}
                viewMode={1}
                dragMode="move"
                cropBoxMovable={true}
                cropBoxResizable={true}
                toggleDragModeOnDblclick={false}
              />
            </CropperContainer>

            {/* 控制面板 */}
            <ControlPanel>
              {/* 旋转和翻转控制 */}
              <ControlSection>
                <SectionTitle>旋转和翻转</SectionTitle>
                <Space size="middle">
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
                  <Button icon={<UndoOutlined />} onClick={resetFilters} size="small">
                    重置
                  </Button>
                </Space>
              </ControlSection>

              {/* 滤镜控制 */}
              <ControlSection>
                <SectionTitle>滤镜调整</SectionTitle>
                <FiltersContainer>
                  <FilterControl>
                    <label>亮度: {brightness}%</label>
                    <Slider min={50} max={150} value={brightness} onChange={setBrightness} style={{ width: 120 }} />
                  </FilterControl>
                  <FilterControl>
                    <label>对比度: {contrast}%</label>
                    <Slider min={50} max={150} value={contrast} onChange={setContrast} style={{ width: 120 }} />
                  </FilterControl>
                  <FilterControl>
                    <label>饱和度: {saturation}%</label>
                    <Slider min={0} max={200} value={saturation} onChange={setSaturation} style={{ width: 120 }} />
                  </FilterControl>
                </FiltersContainer>
              </ControlSection>
            </ControlPanel>
          </>
        )}
      </VStack>
    </Modal>
  )
}

const CropperContainer = styled.div`
  .cropper-view-box,
  .cropper-face {
    border-radius: 50%; /* 圆形裁剪预览 */
  }
`

const ControlPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
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

const FiltersContainer = styled.div`
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
`

const FilterControl = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;

  label {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin: 0;
  }
`

export default ImageEditor
