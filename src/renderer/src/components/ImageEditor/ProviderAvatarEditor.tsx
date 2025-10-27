import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { loggerService } from '@logger'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { Check, FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Undo2, X } from 'lucide-react'
import React, { useCallback, useRef, useState } from 'react'
import { Cropper, ReactCropperElement } from 'react-cropper'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ProviderAvatarEditor')

interface ProviderAvatarEditorProps {
  isOpen: boolean
  onClose: () => void
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
  isOpen,
  onClose,
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
        maxWidth: 200,
        maxHeight: 200,
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
    if (isOpen && imageSrc) {
      setPreviewImage(imageSrc)
      // 延迟一下确保 cropper 已经初始化
      setTimeout(() => {
        updatePreview()
      }, 100)
    }
  }, [isOpen, imageSrc, updatePreview])

  if (!isOpen || !imageSrc) {
    return null
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      classNames={{
        backdrop: 'z-[1001]',
        wrapper: 'z-[1001]'
      }}>
      <ModalContent className="w-fit max-w-screen">
        {() => {
          return (
            <>
              <ModalHeader>
                <h1 className="font-bold text-lg">{title || t('settings.general.avatar.edit')}</h1>
              </ModalHeader>

              <ModalBody>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-6 gap-4 rounded-2xl border p-4">
                    {/* Cropper */}
                    <div className="col-span-5 flex flex-col gap-1">
                      <Cropper
                        ref={cropperRef}
                        src={imageSrc}
                        className="h-75 w-full rounded-xl"
                        aspectRatio={aspectRatio}
                        guides={true}
                        background={false}
                        responsive={true}
                        autoCropArea={0.8}
                        initialAspectRatio={1}
                        minCropBoxHeight={100}
                        minCropBoxWidth={100}
                        zoomable={true}
                        movable={true}
                        rotatable={true}
                        scalable={true}
                        checkOrientation={false}
                        viewMode={1}
                        dragMode="move"
                        cropBoxMovable={true}
                        cropBoxResizable={true}
                        toggleDragModeOnDblclick={false}
                        crop={handleCrop}
                        zoom={handleZoom}
                      />
                      <div className="flex justify-between gap-2">
                        <Button
                          color="primary"
                          startContent={<RotateCcw className="text-primary-foreground" size={14} />}
                          onPress={handleRotateLeft}>
                          {t('settings.general.avatar.rotate_left')}
                        </Button>
                        <Button startContent={<RotateCw size={14} />} onPress={handleRotateRight}>
                          {t('settings.general.avatar.rotate_right')}
                        </Button>
                        <Button startContent={<FlipHorizontal size={14} />} onPress={handleFlipHorizontal}>
                          {t('settings.general.avatar.flip_horizontal')}
                        </Button>
                        <Button startContent={<FlipVertical size={14} />} onPress={handleFlipVertical}>
                          {t('settings.general.avatar.flip_vertical')}
                        </Button>
                        <Button startContent={<Undo2 size={14} />} onPress={resetTransforms}>
                          {t('common.reset')}
                        </Button>
                      </div>
                    </div>

                    {/* Preview */}
                    <div className="col-span-1 p-2">
                      <div className="flex flex-col items-center">
                        <h4 className="font-bold">{t('settings.general.avatar.preview')}</h4>
                        <div className="flex items-center justify-center py-2">
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

                  {/* Guide */}
                  <div className="rounded-2xl border p-4">
                    <h2 className="mb-2 font-bold">💡 {t('settings.general.avatar.usage_guide')}</h2>
                    <ul className="list-inside list-disc">
                      <li>{t('settings.general.avatar.drag_corners_to_resize')}</li>
                      <li>{t('settings.general.avatar.scroll_to_zoom')}</li>
                      <li>{t('settings.general.avatar.use_tools_for_transform')}</li>
                    </ul>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button className="" onPress={handleCancel}>
                  <X size={16} />
                  {t('common.cancel')}
                </Button>
                <Button color="primary" className="" onPress={handleConfirm}>
                  <Check size={16} className="text-primary-foreground" />
                  {t('common.confirm')}
                </Button>
              </ModalFooter>
            </>
          )
        }}
      </ModalContent>
    </Modal>
  )
}

export default ProviderAvatarEditor
