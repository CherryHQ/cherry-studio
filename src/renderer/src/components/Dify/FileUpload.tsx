import { UploadOutlined } from '@ant-design/icons'
import { IFileType, IGetAppParametersResponse, IUploadFileResponse } from '@dify-chat/api'
import i18n from '@renderer/i18n'
import { Flow, FlowEngine } from '@renderer/types'
import { getFileExtension } from '@renderer/utils'
import { Button, message, Upload } from 'antd'
import { RcFile, UploadFile } from 'antd/es/upload'
import { useEffect, useMemo, useState } from 'react'

/**
 * Dify 支持的文件类型和对应的格式
 */
export const FileTypeMap: Map<IFileType, string[]> = new Map()

FileTypeMap.set('document', [
  'txt',
  'md',
  'markdown',
  'pdf',
  'html',
  'xlsx',
  'xls',
  'docx',
  'csv',
  'eml',
  'msg',
  'pptx',
  'ppt',
  'xml',
  'epub'
])
FileTypeMap.set('image', ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'])
FileTypeMap.set('audio', ['mp3', 'm4a', 'wav', 'webm', 'amr'])
FileTypeMap.set('video', ['mp4', 'mov', 'mpeg', 'mpga'])
FileTypeMap.set('custom', [])

export const getFileTypeByName = (filename: string): IFileType => {
  const ext = getFileExtension(filename)?.toLowerCase().replace('.', '') || ''

  for (const [type, extensions] of FileTypeMap.entries()) {
    if (extensions.includes(ext)) {
      return type
    }
  }
  return 'document'
}

export interface IUploadFileItem extends UploadFile {
  type?: string
  transfer_method?: 'local_file' | 'remote_url'
  upload_file_id?: string
  related_id?: string
  remote_url?: string
}

interface IFileUploadCommonProps {
  userId: string
  workflow: Flow
  provider: FlowEngine
  allowed_file_types?: IGetAppParametersResponse['file_upload']['allowed_file_types']
  uploadFile: (provider: FlowEngine, workflow: Flow, file: File, userId: string) => Promise<IUploadFileResponse>
  disabled?: boolean
  maxCount?: number
}

interface IFileUploadSingleProps extends IFileUploadCommonProps {
  value?: IUploadFileItem
  onChange?: (file: IUploadFileItem) => void
  mode: 'single'
}

interface IFileUploadMultipleProps extends IFileUploadCommonProps {
  value?: IUploadFileItem[]
  onChange?: (files: IUploadFileItem[]) => void
  mode?: 'multiple'
}

type IFileUploadProps = IFileUploadSingleProps | IFileUploadMultipleProps

export default function FileUpload(props: IFileUploadProps) {
  const {
    mode = 'multiple',
    maxCount,
    disabled,
    allowed_file_types,
    uploadFile,
    workflow,
    provider,
    value,
    onChange
  } = props

  const [files, setFiles] = useState<IUploadFileItem[]>([])

  const ensureFilesHaveType = (filesToFormat: IUploadFileItem[]): IUploadFileItem[] => {
    return filesToFormat.map((file) => {
      if (file.type && FileTypeMap.has(file.type as IFileType)) {
        return file
      }
      const fileType = file.name ? getFileTypeByName(file.name) : 'document'
      return {
        ...file,
        type: fileType,
        uid: file.uid,
        name: file.name
      }
    })
  }

  useEffect(() => {
    let newFileList: IUploadFileItem[] = []
    if (mode === 'single') {
      newFileList = value ? [value as IUploadFileItem] : []
    } else {
      newFileList = (value as IUploadFileItem[] | undefined) || []
    }
    const formattedNewFileList = ensureFilesHaveType(newFileList)
    if (JSON.stringify(files) !== JSON.stringify(formattedNewFileList)) {
      setFiles(formattedNewFileList)
    }
  }, [value, mode])

  const handleStateUpdateAndOnChange = (updatedFiles: IUploadFileItem[]) => {
    const uniqueFiles = Array.from(new Map(updatedFiles.map((file) => [file.uid, file])).values())
    setFiles(uniqueFiles)
    if (mode === 'single') {
      ;(onChange as IFileUploadSingleProps['onChange'])?.(uniqueFiles[0] || undefined)
    } else {
      ;(onChange as IFileUploadMultipleProps['onChange'])?.(uniqueFiles)
    }
  }

  const allowedFileTypes = useMemo(() => {
    const result: string[] = []
    allowed_file_types?.forEach((item) => {
      if (FileTypeMap.get(item)) {
        result.push(...((FileTypeMap.get(item) as string[]) || []))
      }
    })
    return result
  }, [allowed_file_types])

  const handleUpload = async (file: RcFile) => {
    const fileBaseInfo: IUploadFileItem = {
      uid: file.uid,
      name: file.name,
      status: 'uploading',
      percent: 0,
      transfer_method: 'local_file',
      type: getFileTypeByName(file.name)
    }

    if (mode === 'single') {
      setFiles([fileBaseInfo])
    } else {
      setFiles((prevFiles) => ensureFilesHaveType([...prevFiles.filter((pf) => pf.uid !== file.uid), fileBaseInfo]))
    }

    try {
      const result = await uploadFile(provider, workflow, file, props.userId)
      const uploadedFile: IUploadFileItem = {
        ...fileBaseInfo,
        upload_file_id: result.id,
        status: 'done',
        percent: 100
      }
      if (mode === 'single') {
        handleStateUpdateAndOnChange([uploadedFile])
      } else {
        handleStateUpdateAndOnChange(files.map((f) => (f.uid === file.uid ? uploadedFile : f)))
      }
    } catch (error) {
      console.error(i18n.t('translation.error.file.uploadFailed', { fileName: file.name }), error)
      message.error(`${file.name} ${i18n.t('translation.error.file.uploadFailedSimple')}`)
      const errorFile: IUploadFileItem = {
        ...fileBaseInfo,
        status: 'error',
        percent: 0
      }
      if (mode === 'single') {
        handleStateUpdateAndOnChange([errorFile])
      } else {
        handleStateUpdateAndOnChange(files.map((f) => (f.uid === file.uid ? errorFile : f)))
      }
    }
  }

  return (
    <Upload
      maxCount={mode === 'single' ? 1 : maxCount}
      disabled={disabled}
      fileList={files as UploadFile[]}
      beforeUpload={async (file) => {
        const ext = getFileExtension(file.name).toLowerCase().replace('.', '')

        if (allowedFileTypes.length > 0 && !allowedFileTypes.includes(ext!)) {
          message.error(i18n.t('workflow.error.file.ext'))
          return false
        }

        handleUpload(file as RcFile)
        return false
      }}
      onRemove={(file) => {
        const newFiles = files.filter((item) => item.uid !== file.uid)
        handleStateUpdateAndOnChange(newFiles)
      }}>
      <Button disabled={disabled} icon={<UploadOutlined />}>
        {i18n.t('workflow.file.input.upload')}
      </Button>
    </Upload>
  )
}
