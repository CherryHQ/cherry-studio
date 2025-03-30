import { DeleteOutlined } from '@ant-design/icons'
import { type FileSchema } from '@mistralai/mistralai/src/models/components'
import { useProvider } from '@renderer/hooks/useProvider'
import { runAsyncFunction } from '@renderer/utils'
import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface MistralFilesProps {
  id: string
}

const MistralFiles: FC<MistralFilesProps> = ({ id }) => {
  const { provider } = useProvider(id)
  const { t } = useTranslation()
  const [files, setFiles] = useState<FileSchema[]>([])
  const [loading, setLoading] = useState(false)

  const fetchFiles = useCallback(async () => {
    const response = await window.api.fileService.list(provider.type, provider.apiKey)
    const files = response.files.map((file) => file.originalFile as FileSchema)
    setFiles(files)
  }, [provider])

  const columns: ColumnsType<FileSchema> = [
    {
      title: t('files.name'),
      dataIndex: 'filename',
      key: 'filename'
    },
    {
      title: t('files.type'),
      dataIndex: 'object',
      key: 'object'
    },
    {
      title: t('files.size'),
      dataIndex: 'sizeBytes',
      key: 'sizeBytes',
      render: (size: string) => `${(parseInt(size) / 1024 / 1024).toFixed(2)} MB`
    },
    {
      title: t('files.created_at'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (time: number) => new Date(time * 1000).toLocaleString()
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
              setFiles(files.filter((file) => file.id !== record.id))
              window.api.fileService.delete(provider.type, provider.apiKey, record.id).catch((error) => {
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

export default MistralFiles
