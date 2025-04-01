import { DeleteOutlined } from '@ant-design/icons'
import type { FileMetadataResponse } from '@google/generative-ai/server'
import { useProvider } from '@renderer/hooks/useProvider'
import { runAsyncFunction } from '@renderer/utils'
import { Spin } from 'antd'
import dayjs from 'dayjs'
import { FC, useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import FileItem from './FileItem'

interface GeminiFilesProps {
  id: string
}

const GeminiFiles: FC<GeminiFilesProps> = ({ id }) => {
  const { provider } = useProvider(id)
  const [files, setFiles] = useState<FileMetadataResponse[]>([])
  const [loading, setLoading] = useState(false)

  const fetchFiles = useCallback(async () => {
    const { files } = await window.api.gemini.listFiles(provider.apiKey)
    files && setFiles(files.filter((file) => file.state === 'ACTIVE'))
  }, [provider])

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

  if (loading) {
    return (
      <Container>
        <LoadingWrapper>
          <Spin />
        </LoadingWrapper>
      </Container>
    )
  }

  return (
    <Container>
      <FileListContainer>
        {files.map((file) => (
          <FileItem
            key={file.name}
            fileInfo={{
              name: file.displayName,
              ext: `.${file.name.split('.').pop()}`,
              extra: `${dayjs(file.createTime).format('MM-DD HH:mm')} · ${(parseInt(file.sizeBytes) / 1024 / 1024).toFixed(2)} MB`,
              actions: (
                <DeleteOutlined
                  style={{ cursor: 'pointer', color: 'var(--color-error)' }}
                  onClick={() => {
                    setFiles(files.filter((f) => f.name !== file.name))
                    window.api.gemini.deleteFile(provider.apiKey, file.name).catch((error) => {
                      console.error('Failed to delete file:', error)
                      setFiles((prev) => [...prev, file])
                    })
                  }}
                />
              )
            }}
          />
        ))}
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

export default GeminiFiles
