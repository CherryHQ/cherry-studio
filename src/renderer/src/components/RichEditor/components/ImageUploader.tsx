import { InboxOutlined, LinkOutlined, LoadingOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Flex, Input, message, Modal, Spin, Tabs, Upload } from 'antd'

const { Dragger } = Upload
import type { RcFile } from 'antd/es/upload'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ImageUploaderProps {
  /** Callback when image is selected/uploaded */
  onImageSelect: (imageUrl: string) => void
  /** Whether the uploader is visible */
  visible: boolean
  /** Callback when uploader should be closed */
  onClose: () => void
}

const TabContent = styled.div`
  padding: 24px 0;
  display: flex;
  flex-direction: column;
`

const UrlInput = styled(Input)`
  .ant-input {
    padding: 12px 16px
    font-size: 14px
    border-radius: 4px
    border: 1px solid #dadce0
    transition: all 0.2s ease
    background: #ffffff

    &:hover {
      border-color: #4285f4
    }

    &:focus {
      border-color: #4285f4
      box-shadow: 0 0 0 1px rgba(66, 133, 244, 0.3)
    }
  }
`

// Function to convert file to base64 URL
const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to convert file to base64'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelect, visible, onClose }) => {
  const { t } = useTranslation()
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleFileSelect = async (file: RcFile) => {
    try {
      setLoading(true)

      // Validate file type
      const isImage = file.type.startsWith('image/')
      if (!isImage) {
        message.error(t('richEditor.imageUploader.invalidType'))
        return false
      }

      // Validate file size (max 10MB)
      const isLt10M = file.size / 1024 / 1024 < 10
      if (!isLt10M) {
        message.error(t('richEditor.imageUploader.tooLarge'))
        return false
      }

      // Convert to base64 and call callback
      const base64Url = await convertFileToBase64(file)
      onImageSelect(base64Url)
      message.success(t('richEditor.imageUploader.uploadSuccess'))
      onClose()
    } catch (error) {
      message.error(t('richEditor.imageUploader.uploadError'))
    } finally {
      setLoading(false)
    }

    return false // Prevent default upload
  }

  const handleUrlSubmit = () => {
    if (!urlInput.trim()) {
      message.error(t('richEditor.imageUploader.urlRequired'))
      return
    }

    // Basic URL validation
    try {
      new URL(urlInput.trim())
      onImageSelect(urlInput.trim())
      message.success(t('richEditor.imageUploader.embedSuccess'))
      setUrlInput('')
      onClose()
    } catch {
      message.error(t('richEditor.imageUploader.invalidUrl'))
    }
  }

  const handleCancel = () => {
    setUrlInput('')
    onClose()
  }

  const tabItems = [
    {
      key: 'upload',
      label: (
        <div>
          <UploadOutlined size={18} style={{ marginRight: 8 }} />
          {t('richEditor.imageUploader.upload')}
        </div>
      ),
      children: (
        <TabContent>
          <Dragger
            accept="image/*"
            showUploadList={false}
            beforeUpload={handleFileSelect}
            customRequest={() => {}} // Prevent default upload
            disabled={loading}>
            {loading ? (
              <>
                <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                <p className="ant-upload-text">{t('richEditor.imageUploader.uploading')}</p>
                <p className="ant-upload-hint">{t('richEditor.imageUploader.processing')}</p>
              </>
            ) : (
              <>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">{t('richEditor.imageUploader.uploadText')}</p>
                <p className="ant-upload-hint">{t('richEditor.imageUploader.uploadHint')}</p>
              </>
            )}
          </Dragger>
        </TabContent>
      )
    },
    {
      key: 'url',
      label: (
        <span>
          <LinkOutlined style={{ marginRight: 8 }} />
          {t('richEditor.imageUploader.embedLink')}
        </span>
      ),
      children: (
        <TabContent>
          <Flex gap={12} justify="center">
            <UrlInput
              placeholder={t('richEditor.imageUploader.urlPlaceholder')}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onPressEnter={handleUrlSubmit}
              prefix={<LinkOutlined style={{ color: '#999' }} />}
              style={{ flex: 1 }}
            />
            <Button
              onClick={() => setUrlInput('')}
              style={{
                border: '1px solid #dadce0',
                borderRadius: '4px',
                color: '#3c4043',
                background: '#ffffff'
              }}>
              {t('common.clear')}
            </Button>
            <Button type="primary" onClick={handleUrlSubmit} disabled={!urlInput.trim()}>
              {t('richEditor.imageUploader.embedImage')}
            </Button>
          </Flex>
        </TabContent>
      )
    }
  ]

  return (
    <Modal
      title={t('richEditor.imageUploader.title')}
      open={visible}
      onCancel={handleCancel}
      footer={null}
      width={600}
      centered>
      <Tabs defaultActiveKey="upload" items={tabItems} size="large" />
    </Modal>
  )
}
