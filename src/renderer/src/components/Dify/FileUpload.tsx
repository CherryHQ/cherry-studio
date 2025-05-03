import { UploadOutlined } from '@ant-design/icons'
import { IFileType, IGetAppParametersResponse, IUploadFileResponse } from '@dify-chat/api'
import i18n from '@renderer/i18n'
import { Flow, FlowEngine } from '@renderer/types'
import { getFileExtension } from '@renderer/utils'
import { Button, GetProp, message, Upload } from 'antd'
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
  const ext = filename.split('.').pop()

  // 使用文件扩展名和 FileTypeMap 进行匹配
  let fileType: IFileType = 'document'
  FileTypeMap.forEach((extensions, type) => {
    if (extensions.indexOf(ext as string) > -1) {
      fileType = type
    }
  })
  return fileType
}

export interface IUploadFileItem extends UploadFile {
  type?: string
  transfer_method?: 'local_file' | 'remote_url'
  upload_file_id?: string
  related_id?: string
  remote_url?: string
  filename?: string
}

interface IFileUploadCommonProps {
  workflow: Flow
  provider: FlowEngine
  allowed_file_types?: IGetAppParametersResponse['file_upload']['allowed_file_types']
  uploadFile: (provider: FlowEngine, workflow: Flow, file: File) => Promise<IUploadFileResponse>
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

  console.log('FileUpload props:', props)
  const [files, setFiles] = useState<GetProp<typeof Upload, 'fileList'>>([])

  useEffect(() => {
    if (mode === 'single') {
      setFiles(value ? [value as IUploadFileItem] : [])
    } else {
      const multiModeValues = value as IUploadFileItem[] | undefined
      if (multiModeValues?.length && multiModeValues?.length !== files.length) {
        setFiles(multiModeValues)
      }
    }
  }, [value])

  const formatFiles = (files: IUploadFileItem[]) => {
    return files?.map((file) => {
      const fileType = getFileTypeByName(file.name)
      return {
        ...file,
        type: fileType
      }
    })
  }

  const updateFiles = (newFiles: IUploadFileItem[], action: 'update' | 'remove' = 'update') => {
    const formattedNewFiles = formatFiles(newFiles)
    const newFilesState =
      mode === 'single' ? formattedNewFiles : action === 'remove' ? newFiles : [...files, ...formattedNewFiles]
    setFiles(newFilesState)
    if (mode === 'single') {
      ;(onChange as IFileUploadSingleProps['onChange'])?.(newFilesState[0])
    } else {
      ;(onChange as IFileUploadMultipleProps['onChange'])?.(newFilesState)
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
    const prevFiles = [...files]
    console.log('handleUpload', prevFiles)

    const fileBaseInfo: IUploadFileItem = {
      uid: file.uid,
      name: file.name,
      transfer_method: 'local_file'
    }

    // const result = await uploadFile(provider, workflow, file)
    const result = {
      id: 'fa078ebc-7dcd-4afc-9df1-1b4a0981a052',
      name: '1706.03762v7.pdf',
      size: 2215244,
      extension: 'pdf',
      mime_type: 'application/pdf',
      created_by: '57414477-3c1b-4728-b9bc-0b29742f6950',
      created_at: 1746177704,
      preview_url: null
    }

    const fileType = getFileTypeByName(file.name)
    updateFiles([
      {
        ...fileBaseInfo,
        upload_file_id: result.id,
        // type: fileType || 'document'
        type: 'document'
      }
    ])
  }

  return (
    <Upload
      maxCount={mode === 'single' ? 1 : maxCount}
      disabled={disabled}
      fileList={files}
      beforeUpload={async (file) => {
        // 校验文件类型
        // 自定义上传
        const ext = getFileExtension(file.name).replace('.', '') // 获取文件扩展名

        // 校验文件类型
        if (allowedFileTypes.length > 0 && !allowedFileTypes.includes(ext!)) {
          message.error(i18n.t('translation.error.file.ext'))
          return false
        }

        handleUpload(file)
        return false
      }}
      onRemove={(file) => {
        updateFiles(
          files.filter((item) => item.uid !== file.uid),
          'remove'
        )
      }}>
      <Button disabled={disabled} icon={<UploadOutlined />}>
        点击上传
      </Button>
    </Upload>
  )
}
