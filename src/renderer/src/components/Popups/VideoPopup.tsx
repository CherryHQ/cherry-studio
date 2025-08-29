import { UploadOutlined } from '@ant-design/icons'
import FileManager from '@renderer/services/FileManager'
import { loggerService } from '@renderer/services/LoggerService'
import { FileMetadata, FileTypes } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Modal, Space, Upload } from 'antd'
// 导入 antd 的 UploadFile 类型
import type { UploadFile } from 'antd/es/upload/interface'
import { useState } from 'react'

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
  return (
    <div>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>{title}</div>
      <Dragger
        name={uploadType}
        accept={accept}
        maxCount={1}
        fileList={fileList}
        customRequest={({ file }) => onUpload(file as File)}
        onRemove={onRemove}>
        <p className="ant-upload-drag-icon">
          <UploadOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽文件到此区域</p>
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
        type: file.type as FileTypes,
        created_at: new Date().toISOString()
      }

      const uploadedFile = await FileManager.uploadFile(newFileMetadata)
      setFile(uploadedFile)

      // 更新UI，显示上传完成
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
      okText="确定"
      cancelText="取消">
      <Space direction="vertical" style={{ width: '100%', gap: '16px' }}>
        <SingleFileUploader
          uploadType="video"
          accept="video/*"
          title="视频文件:"
          hint="支持 MP4, AVI, MOV 等视频格式"
          fileList={videoFileList}
          onUpload={(file) => handleFileUpload(file, 'video', setVideoFile, setVideoFileList)}
          onRemove={() => handleFileRemove(setVideoFile, setVideoFileList)}
        />

        <SingleFileUploader
          uploadType="srt"
          accept=".srt"
          title="字幕文件:"
          hint="支持 .srt 格式的字幕文件"
          fileList={srtFileList}
          onUpload={(file) => handleFileUpload(file, 'srt', setSrtFile, setSrtFileList)}
          onRemove={() => handleFileRemove(setSrtFile, setSrtFileList)}
        />
      </Space>
    </Modal>
  )
}

const TopViewKey = 'VideoPopup'

// --- 导出部分保持不变 ---
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
