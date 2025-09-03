import { UploadOutlined } from '@ant-design/icons'
import FileManager from '@renderer/services/FileManager'
import { loggerService } from '@renderer/services/LoggerService'
import { FileMetadata } from '@renderer/types'
import { mime2type, uuid } from '@renderer/utils'
import { Modal, Space, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const logger = loggerService.withContext('Video Popup')
const { Dragger } = Upload

export interface VideoUploadResult {
  videoFile: FileMetadata
  srtFile: FileMetadata
}

interface VideoPopupShowParams {
  title: string
}

interface Props extends VideoPopupShowParams {
  resolve: (value: VideoUploadResult | null) => void
}

type UploadType = 'video' | 'srt'

interface SingleFileUploaderProps {
  uploadType: UploadType
  accept: string
  title: string
  hint: string
  fileList: UploadFile[]
  onUpload: (file: File) => void
  onRemove: () => void
}

const SingleFileUploader: React.FC<SingleFileUploaderProps> = ({
  uploadType,
  accept,
  title,
  hint,
  fileList,
  onUpload,
  onRemove
}) => {
  const { t } = useTranslation()
  return (
    <div>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>{title}</div>
      <Dragger
        name={uploadType}
        accept={accept}
        maxCount={1}
        fileList={fileList}
        customRequest={({ file }) => {
          if (file instanceof File) {
            onUpload(file)
          } else {
            logger.error('Upload failed: Invalid file format')
          }
        }}
        onRemove={onRemove}>
        <p className="ant-upload-drag-icon">
          <UploadOutlined />
        </p>
        <p className="ant-upload-text">{t('knowledge.drag_file')}</p>
        <p className="ant-upload-hint">{hint}</p>
      </Dragger>
    </div>
  )
}

const VideoPopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [result, setResult] = useState<VideoUploadResult | null>(null)

  const [videoFile, setVideoFile] = useState<FileMetadata | null>(null)
  const [srtFile, setSrtFile] = useState<FileMetadata | null>(null)

  const [videoFileList, setVideoFileList] = useState<UploadFile[]>([])
  const [srtFileList, setSrtFileList] = useState<UploadFile[]>([])

  const { t } = useTranslation()

  const handleFileUpload = async (
    file: File,
    uploadType: UploadType,
    setFile: (data: FileMetadata | null) => void,
    setFileList: (list: UploadFile[]) => void
  ) => {
    const tempId = uuid()
    const tempFile: UploadFile = {
      uid: tempId,
      name: file.name,
      status: 'uploading'
    }
    setFileList([tempFile])

    try {
      const newFileMetadata: FileMetadata = {
        id: uuid(),
        name: file.name,
        path: window.api.file.getPathForFile(file),
        size: file.size,
        ext: `.${file.name.split('.').pop()?.toLowerCase()}`,
        count: 1,
        origin_name: file.name,
        type: mime2type(file.type),
        created_at: new Date().toISOString()
      }

      const uploadedFile = await FileManager.uploadFile(newFileMetadata)
      setFile(uploadedFile)

      setFileList([{ ...tempFile, status: 'done', url: uploadedFile.path }])
    } catch (error) {
      logger.error(`Failed to upload ${uploadType} file: ${error}`)
      setFileList([{ ...tempFile, status: 'error', response: '上传失败' }])
      setFile(null)
    }
  }

  const handleFileRemove = (
    setFile: (data: FileMetadata | null) => void,
    setFileList: (list: UploadFile[]) => void
  ) => {
    setFile(null)
    setFileList([])
    return true
  }

  const onOk = () => {
    if (videoFile && srtFile) {
      setResult({ videoFile, srtFile })
      setOpen(false)
    }
  }

  const onCancel = () => {
    setResult(null)
    setOpen(false)
  }

  const onAfterClose = () => {
    resolve(result)
    TopView.hide(TopViewKey)
  }

  VideoPopup.hide = onCancel
  const isOkButtonDisabled = !videoFile || !srtFile

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onAfterClose}
      transitionName="animation-move-down"
      centered
      width={600}
      okButtonProps={{ disabled: isOkButtonDisabled }}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}>
      <Space direction="vertical" style={{ width: '100%', gap: '16px' }}>
        <SingleFileUploader
          uploadType="video"
          accept="video/*"
          title={t('knowledge.videos_file')}
          hint={t('knowledge.file_hint', { file_types: 'MP4, AVI, MKV, MOV' })}
          fileList={videoFileList}
          onUpload={(file) => handleFileUpload(file, 'video', setVideoFile, setVideoFileList)}
          onRemove={() => handleFileRemove(setVideoFile, setVideoFileList)}
        />

        <SingleFileUploader
          uploadType="srt"
          accept=".srt"
          title={t('knowledge.subtitle_file')}
          hint={t('knowledge.file_hint', { file_types: 'SRT' })}
          fileList={srtFileList}
          onUpload={(file) => handleFileUpload(file, 'srt', setSrtFile, setSrtFileList)}
          onRemove={() => handleFileRemove(setSrtFile, setSrtFileList)}
        />
      </Space>
    </Modal>
  )
}

const TopViewKey = 'VideoPopup'

export default class VideoPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: VideoPopupShowParams) {
    return new Promise<VideoUploadResult | null>((resolve) => {
      TopView.show(<VideoPopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
