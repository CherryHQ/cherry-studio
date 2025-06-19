import { DeleteOutlined } from '@ant-design/icons'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { useTheme } from '@renderer/context/ThemeProvider'
import { FileMetadata } from '@renderer/types'
import { Popconfirm, Upload } from 'antd'
import { Button } from 'antd'
import type { RcFile, UploadProps } from 'antd/es/upload'
import React from 'react'
import styled from 'styled-components'

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
      <HeaderContainer>
        {fileMap.imageFiles && fileMap.imageFiles.length > 0 && (
          <Button size="small" onClick={onClearImages}>
            清除全部
          </Button>
        )}
      </HeaderContainer>

      <UploadImageList>
        {fileMap.paths && fileMap.paths.length > 0 ? (
          <>
            {fileMap.paths.map((src, index) => (
              <UploadImageItem key={index}>
                <ImageUploadButton
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
                  <ImagePreview>
                    <img src={src} alt={`预览图${index + 1}`} />
                  </ImagePreview>
                </ImageUploadButton>
                <Popconfirm
                  title="确定要删除这张图片吗？"
                  okText="确定"
                  cancelText="取消"
                  onConfirm={() => onDeleteImage(index)}>
                  <DeleteButton>
                    <DeleteOutlined />
                  </DeleteButton>
                </Popconfirm>
              </UploadImageItem>
            ))}
          </>
        ) : (
          ''
        )}

        {fileMap.imageFiles && fileMap.imageFiles.length < maxImages ? (
          <UploadImageItem>
            <ImageUploadButton
              multiple={false}
              accept="image/png, image/jpeg"
              maxCount={1}
              showUploadList={false}
              listType="picture-card"
              action=""
              customRequest={customRequest}
              beforeUpload={(file) => {
                handleBeforeUpload(file)
              }}>
              <ImageSizeImage src={IcImageUp} theme={theme} />
            </ImageUploadButton>
          </UploadImageItem>
        ) : (
          ''
        )}
      </UploadImageList>
    </>
  )
}

// 样式组件
const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 10px;
`

const ImageUploadButton = styled(Upload)`
  & .ant-upload.ant-upload-select,
  .ant-upload-list-item-container {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1 !important;
  }
  margin-bottom: 5px;
`

const ImagePreview = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  border-radius: 6px;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &:hover::after {
    content: '点击替换';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
`

const ImageSizeImage = styled.img<{ theme: string }>`
  filter: ${({ theme }) => (theme === 'dark' ? 'invert(100%)' : 'none')};
  margin-top: 8px;
`

const UploadImageList = styled.div`
  display: flex;
  flex-wrap: wrap;
`

const UploadImageItem = styled.div`
  width: 45%;
  height: 45%;
  margin-bottom: 5px;
  margin-right: 5px;
  position: relative;
`

const DeleteButton = styled.button`
  position: absolute;
  top: 5px;
  right: 5px;
  background-color: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.3s ease;
  z-index: 10;

  &:hover {
    opacity: 1;
  }
`

export default ImageUploader
