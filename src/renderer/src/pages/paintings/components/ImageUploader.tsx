import { DeleteOutlined } from '@ant-design/icons'
import { Button } from '@cherrystudio/ui'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FileMetadata } from '@renderer/types'
import { Popconfirm, Upload } from 'antd'
import type { RcFile, UploadProps } from 'antd/es/upload'
import React from 'react'
import { useTranslation } from 'react-i18next'

interface ImageUploaderProps {
  fileMap: {
    imageFiles?: FileMetadata[]
    paths?: string[]
  }
  maxImages: number
  onClearImages: () => void
  onDeleteImage: (index: number) => void
  onAddImage: (file: File, index?: number) => void
  mode: string
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
  fileMap,
  maxImages,
  onClearImages,
  onDeleteImage,
  onAddImage
}) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const imageCount = fileMap.imageFiles?.length || 0
  const remainingImages = Math.max(maxImages - imageCount, 0)

  const handleBeforeUpload = (file: RcFile, index?: number) => {
    onAddImage(file, index)
    return false // 阻止默认上传行为
  }

  // 自定义上传请求，不执行任何网络请求
  const customRequest: UploadProps['customRequest'] = ({ onSuccess }) => {
    if (onSuccess) {
      onSuccess('ok' as any)
    }
  }

  return (
    <>
      <div className="mb-2.5 flex items-center">
        {fileMap.imageFiles && fileMap.imageFiles.length > 0 && (
          <Button size="sm" onClick={onClearImages}>
            {t('common.clear_all')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap">
        {fileMap.paths && fileMap.paths.length > 0 ? (
          <>
            {fileMap.paths.map((src, index) => (
              <div key={index} className="relative mr-1.25 mb-1.25 h-[45%] w-[45%]">
                <Upload
                  className="mb-1.25 [&_.ant-upload-list-item-container]:aspect-square! [&_.ant-upload-list-item-container]:h-full! [&_.ant-upload-list-item-container]:w-full! [&_.ant-upload.ant-upload-select]:aspect-square! [&_.ant-upload.ant-upload-select]:h-full! [&_.ant-upload.ant-upload-select]:w-full!"
                  accept="image/png, image/jpeg"
                  maxCount={1}
                  multiple={false}
                  showUploadList={false}
                  listType="picture-card"
                  action=""
                  customRequest={customRequest}
                  beforeUpload={(file) => {
                    handleBeforeUpload(file, index)
                  }}>
                  <div className="group relative h-full w-full overflow-hidden rounded-md">
                    <img
                      src={src}
                      alt={`${t('common.image_preview')} ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0 flex cursor-pointer items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {t('common.click_to_replace')}
                    </div>
                  </div>
                </Upload>
                <Popconfirm
                  title={t('paintings.button.delete.image.confirm')}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => onDeleteImage(index)}>
                  <button
                    type="button"
                    className="absolute top-1.25 right-1.25 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 text-white opacity-70 transition-opacity duration-300 ease-in-out hover:opacity-100">
                    <DeleteOutlined />
                  </button>
                </Popconfirm>
              </div>
            ))}
          </>
        ) : (
          ''
        )}

        {remainingImages > 0 ? (
          <div className="relative mr-1.25 mb-1.25 h-[45%] w-[45%]">
            <Upload
              className="mb-1.25 [&_.ant-upload-list-item-container]:aspect-square! [&_.ant-upload-list-item-container]:h-full! [&_.ant-upload-list-item-container]:w-full! [&_.ant-upload.ant-upload-select]:aspect-square! [&_.ant-upload.ant-upload-select]:h-full! [&_.ant-upload.ant-upload-select]:w-full!"
              multiple={remainingImages > 1}
              accept="image/png, image/jpeg"
              maxCount={remainingImages}
              showUploadList={false}
              listType="picture-card"
              action=""
              customRequest={customRequest}
              beforeUpload={(file) => {
                handleBeforeUpload(file)
              }}>
              <img src={IcImageUp} alt="" className={theme === 'dark' ? 'mt-2 invert' : 'mt-2'} />
            </Upload>
          </div>
        ) : (
          ''
        )}
      </div>
    </>
  )
}

export default ImageUploader
