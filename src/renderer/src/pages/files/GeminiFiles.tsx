import { DeleteOutlined } from '@ant-design/icons'
import type { FileMetadataResponse } from '@google/generative-ai/server'
import { useProvider } from '@renderer/hooks/useProvider'
import { runAsyncFunction } from '@renderer/utils'
import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface GeminiFilesProps {
  id: string
}

const GeminiFiles: FC<GeminiFilesProps> = ({ id }) => {
  const { provider } = useProvider(id)
  const [files, setFiles] = useState<FileMetadataResponse[]>([])
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)

  const fetchFiles = useCallback(async () => {
    const { files } = await window.api.gemini.listFiles(provider.apiKey)
    files && setFiles(files.filter((file) => file.state === 'ACTIVE'))
  }, [provider])

  const columns: ColumnsType<FileMetadataResponse> = [
    {
      title: t('files.name'),
      dataIndex: 'displayName',
      key: 'displayName'
    },
    {
      title: t('files.type'),
      dataIndex: 'mimeType',
      key: 'mimeType'
    },
    {
      title: t('files.size'),
      dataIndex: 'sizeBytes',
      key: 'sizeBytes',
      render: (size: string) => `${(parseInt(size) / 1024 / 1024).toFixed(2)} MB`
    },
    {
      title: t('files.created_at'),
      dataIndex: 'createTime',
      key: 'createTime',
      render: (time: string) => new Date(time).toLocaleString()
    },
    {
      title: t('files.actions'),
      dataIndex: 'actions',
      key: 'actions',
      align: 'center',
      render: (_, record) => {
        return (
          <DeleteOutlined
            style={{ cursor: 'pointer', color: 'var(--color-error)' }}
            onClick={() => {
              setFiles(files.filter((file) => file.name !== record.name))
              window.api.gemini.deleteFile(provider.apiKey, record.name).catch((error) => {
                console.error('Failed to delete file:', error)
                setFiles((prev) => [...prev, record])
              })
            }}
          />
        )
      }
    }
  ]

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

  return (
    <Container>
      <Table columns={columns} dataSource={files} rowKey="name" loading={loading} />
    </Container>
  )
}

const Container = styled.div``

export default GeminiFiles
