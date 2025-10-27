import { loggerService } from '@logger'
import { VStack } from '@renderer/components/Layout'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { classNames } from '@renderer/utils'
import { Check, FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Undo2, X } from 'lucide-react'
import React, { useCallback, useRef, useState } from 'react'
import Cropper, { ReactCropperElement } from 'react-cropper'
import { useTranslation } from 'react-i18next'

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
  providerName?: string
}

const ProviderAvatarEditor: React.FC<ProviderAvatarEditorProps> = ({
  open,
  imageSrc,
  onCancel,
  onConfirm,
  title,
  aspectRatio = 1, // 默认正方形
  maxWidth = 200,
  maxHeight = 200,
  providerName = 'Provider'
}) => {
  const { t } = useTranslation()
  const cropperRef = useRef<ReactCropperElement>(null)
  const [scaleX, setScaleX] = useState(1)
  const [scaleY, setScaleY] = useState(1)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  const updatePreview = useCallback(() => {
    if (!cropperRef.current?.cropper) {
      return
    }

    try {
      const canvas = cropperRef.current.cropper.getCroppedCanvas({
        maxWidth: 60,
        maxHeight: 60,
        fillColor: '#ffffff',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      })

      const previewDataUrl = canvas.toDataURL('image/png', 0.9)
      setPreviewImage(previewDataUrl)
    } catch (error) {
      logger.error('Preview update failed:', error as Error)
    }
  }, [])

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
      updatePreview()
    }
  }, [updatePreview])

  const handleRotateRight = useCallback(() => {
    if (cropperRef.current?.cropper) {
      cropperRef.current.cropper.rotate(90)
      updatePreview()
    }
  }, [updatePreview])

  const handleFlipHorizontal = useCallback(() => {
    if (cropperRef.current?.cropper) {
      const newScaleX = scaleX * -1
      cropperRef.current.cropper.scaleX(newScaleX)
      setScaleX(newScaleX)
      updatePreview()
    }
  }, [scaleX, updatePreview])

  const handleFlipVertical = useCallback(() => {
    if (cropperRef.current?.cropper) {
      const newScaleY = scaleY * -1
      cropperRef.current.cropper.scaleY(newScaleY)
      setScaleY(newScaleY)
      updatePreview()
    }
  }, [scaleY, updatePreview])

  const handleCrop = useCallback(() => {
    updatePreview()
  }, [updatePreview])

  const handleZoom = useCallback(() => {
    updatePreview()
  }, [updatePreview])

  const handleConfirm = useCallback(async () => {
    if (!cropperRef.current?.cropper) {
      window.toast.error(t('settings.general.avatar.editor_not_ready'))
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
            window.toast.error(t('settings.general.avatar.processing_failed'))
          }
        },
        'image/png',
        0.9
      )
    } catch (error) {
      logger.error('Image editing failed:', error as Error)
      window.toast.error(t('settings.general.avatar.editing_failed'))
    }
  }, [maxWidth, maxHeight, onConfirm, t])

  const handleCancel = useCallback(() => {
    resetTransforms()
    setPreviewImage(null)
    onCancel()
  }, [onCancel, resetTransforms])

  // 当图片源改变时，初始化预览
  React.useEffect(() => {
    if (open && imageSrc) {
      setPreviewImage(imageSrc)
      // 延迟一下确保 cropper 已经初始化
      setTimeout(() => {
        updatePreview()
      }, 100)
    }
  }, [open, imageSrc, updatePreview])

  if (!open || !imageSrc) {
    return null
  }

  return (
    <div className={classNames(styles.modal, { [styles.hidden]: !open })}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title || t('settings.general.avatar.edit')}</h3>
          <button type="button" className={styles.modalCloseButton} onClick={handleCancel}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <VStack gap="16px">
            {/* 主编辑区域 */}
            <div className={styles.editorContainer}>
              {/* 左侧：图片裁剪区域 */}
              <div className={styles.cropperSection}>
                <div className={styles.cropperContainer}>
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
                    crop={handleCrop}
                    zoom={handleZoom}
                  />
                </div>
              </div>

              {/* 右侧：实时预览区域 */}
              <div className={styles.previewSection}>
                <h4 className={styles.previewTitle}>{t('settings.general.avatar.preview')}</h4>
                <div className={styles.previewContainer}>
                  <div className={styles.previewAvatar}>
                    <ProviderAvatarPrimitive
                      providerId="preview"
                      providerName={providerName}
                      logoSrc={previewImage || undefined}
                      size={60}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 控制面板 */}
            <div className={styles.controlPanel}>
              <div className={styles.controlSection}>
                <h4 className={styles.sectionTitle}>{t('settings.general.avatar.edit_tools')}</h4>
                <div className={styles.space}>
                  <button type="button" className={classNames(styles.button, styles.small)} onClick={handleRotateLeft}>
                    <RotateCcw size={14} />
                    {t('settings.general.avatar.rotate_left')}
                  </button>
                  <button type="button" className={classNames(styles.button, styles.small)} onClick={handleRotateRight}>
                    <RotateCw size={14} />
                    {t('settings.general.avatar.rotate_right')}
                  </button>
                  <button
                    type="button"
                    className={classNames(styles.button, styles.small)}
                    onClick={handleFlipHorizontal}>
                    <FlipHorizontal size={14} />
                    {t('settings.general.avatar.flip_horizontal')}
                  </button>
                  <button
                    type="button"
                    className={classNames(styles.button, styles.small)}
                    onClick={handleFlipVertical}>
                    <FlipVertical size={14} />
                    {t('settings.general.avatar.flip_vertical')}
                  </button>
                  <button type="button" className={classNames(styles.button, styles.small)} onClick={resetTransforms}>
                    <Undo2 size={14} />
                    {t('common.reset')}
                  </button>
                </div>
              </div>

              <div className={styles.tipText}>
                💡 {t('settings.general.avatar.usage_guide')}
                <br />• {t('settings.general.avatar.drag_corners_to_resize')}
                <br />• {t('settings.general.avatar.scroll_to_zoom')}
                <br />• {t('settings.general.avatar.use_tools_for_transform')}
              </div>
            </div>
          </VStack>
        </div>
        <div className={styles.modalFooter}>
          <button type="button" className={styles.button} onClick={handleCancel}>
            <X size={16} />
            {t('common.cancel')}
          </button>
          <button type="button" className={classNames(styles.button, styles.primary)} onClick={handleConfirm}>
            <Check size={16} />
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProviderAvatarEditor
