import { DeleteOutlined } from '@ant-design/icons'
import { useProvider } from '@renderer/hooks/useProvider'
import { isGeminiFile, isMistralFile, RemoteFile } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { Spin } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import FileItem from './FileItem'

interface RemoteFileListProps {
  id: string
  formatFileDate: (date: string | number) => string
  formatFileSize: (size: string | number) => string
}

const RemoteFileList: FC<RemoteFileListProps> = ({ id, formatFileDate, formatFileSize }) => {
  const { provider } = useProvider(id)
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [loading, setLoading] = useState(false)

  const getFileName = (file: RemoteFile): string => {
    if (isGeminiFile(file)) {
      return file.file.displayName || ''
    } else if (isMistralFile(file)) {
      return file.file.filename
    } else {
      return ''
    }
  }

  const getFileId = (file: RemoteFile): string => {
    if (isGeminiFile(file)) {
      return file.file.name || ''
    } else if (isMistralFile(file)) {
      return file.file.id || ''
    } else {
      return ''
    }
  }

  const getFileDate = (file: RemoteFile): string | number => {
    if (isGeminiFile(file)) {
      return file.file.createTime || new Date().toISOString()
    } else if (isMistralFile(file)) {
      return file.file.createdAt || new Date().toISOString()
    } else {
      return new Date().toISOString()
    }
  }

  const getFileSize = (file: RemoteFile): string | number => {
    return file.file.sizeBytes || '0'
  }

  // Use provided formatters
  const formatDateFn = formatFileDate
  const formatSizeFn = formatFileSize
  const getFileNameFn = getFileName
  const getFileIdFn = getFileId

  const fetchFiles = useCallback(async () => {
    const type = provider.type
    const response = await window.api.fileService.list(type, provider.apiKey)
    const fetchedFiles = response.files.filter(Boolean).map((file) => file.originalFile)
    setFiles(fetchedFiles)
  }, [provider.apiKey, provider.type])

  useEffect(() => {
    runAsyncFunction(async () => {
      try {
        setLoading(true)
        await fetchFiles()
        setLoading(false)
      } catch (error: any) {
        console.error('Failed to fetch files:', error)
        window.message.error(error.message)
        setLoading(false)
      }
    })
  }, [fetchFiles])

  useEffect(() => {
    setFiles([])
  }, [id])

  const handleDeleteFile = (file: RemoteFile) => {
    const fileId = getFileIdFn(file)

    setFiles(files.filter((f) => getFileIdFn(f) !== fileId))

    window.api.fileService.delete(file.type, provider.apiKey, fileId).catch((error) => {
      console.error('Failed to delete file:', error)
      setFiles((prev) => [...prev, file])
    })
  }

  if (loading) {
    return (
      <LoadingWrapper>
        <Spin />
      </LoadingWrapper>
    )
  }

  return (
    <Container>
      <FileListContainer>
        {files.map((file) => {
          const fileName = getFileNameFn(file)
          const fileExt = `.${fileName?.split('.').pop()}`

          return (
            <FileItem
              key={getFileIdFn(file)}
              fileInfo={{
                name: fileName,
                ext: fileExt,
                extra: `${formatDateFn(getFileDate(file))} · ${formatSizeFn(getFileSize(file))}`,
                actions: (
                  <DeleteOutlined
                    style={{ cursor: 'pointer', color: 'var(--color-error)' }}
                    onClick={() => handleDeleteFile(file)}
                  />
                )
              }}
            />
          )
        })}
      </FileListContainer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
`

const FileListContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const LoadingWrapper = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
`

export default RemoteFileList
