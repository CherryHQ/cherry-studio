import { DeleteOutlined, ExclamationCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { restoreFromS3 } from '@renderer/services/BackupService'
import type { S3Config } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Button, Modal, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface BackupFile {
  fileName: string
  modifiedTime: string
  size: number
}

interface S3BackupManagerProps {
  visible: boolean
  onClose: () => void
  s3Config: Partial<S3Config>
  restoreMethod?: (fileName: string) => Promise<void>
}

export function S3BackupManager({ visible, onClose, s3Config, restoreMethod }: S3BackupManagerProps) {
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 5,
    total: 0
  })
  const { t } = useTranslation()

  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = s3Config

  const fetchBackupFiles = useCallback(async () => {
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error(t('settings.data.s3.manager.config.incomplete'))
      return
    }

    setLoading(true)
    try {
      const files = await window.api.backup.listS3Files({
        ...s3Config,
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        skipBackupFile: false,
        autoSync: false,
        syncInterval: 0,
        maxBackups: 0
      })
      setBackupFiles(files)
      setPagination((prev) => ({
        ...prev,
        total: files.length
      }))
    } catch (error: any) {
      window.message.error(t('settings.data.s3.manager.files.fetch.error', { message: error.message }))
    } finally {
      setLoading(false)
    }
  }, [endpoint, region, bucket, accessKeyId, secretAccessKey, t, s3Config])

  useEffect(() => {
    if (visible) {
      fetchBackupFiles()
      setSelectedRowKeys([])
      setPagination((prev) => ({
        ...prev,
        current: 1
      }))
    }
  }, [visible, fetchBackupFiles])

  const handleTableChange = (pagination: any) => {
    setPagination(pagination)
  }

  const handleDeleteSelected = async () => {
    if (selectedRowKeys.length === 0) {
      window.message.warning(t('settings.data.s3.manager.select.warning'))
      return
    }

    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error(t('settings.data.s3.manager.config.incomplete'))
      return
    }

    window.modal.confirm({
      title: t('settings.data.s3.manager.delete.confirm.title'),
      icon: <ExclamationCircleOutlined />,
      content: t('settings.data.s3.manager.delete.confirm.multiple', { count: selectedRowKeys.length }),
      okText: t('settings.data.s3.manager.delete.confirm.title'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: async () => {
        setDeleting(true)
        try {
          // 依次删除选中的文件
          for (const key of selectedRowKeys) {
            await window.api.backup.deleteS3File(key.toString(), {
              ...s3Config,
              endpoint,
              region,
              bucket,
              accessKeyId,
              secretAccessKey,
              skipBackupFile: false,
              autoSync: false,
              syncInterval: 0,
              maxBackups: 0
            })
          }
          window.message.success(
            t('settings.data.s3.manager.delete.success.multiple', { count: selectedRowKeys.length })
          )
          setSelectedRowKeys([])
          await fetchBackupFiles()
        } catch (error: any) {
          window.message.error(t('settings.data.s3.manager.delete.error', { message: error.message }))
        } finally {
          setDeleting(false)
        }
      }
    })
  }

  const handleDeleteSingle = async (fileName: string) => {
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error(t('settings.data.s3.manager.config.incomplete'))
      return
    }

    window.modal.confirm({
      title: t('settings.data.s3.manager.delete.confirm.title'),
      icon: <ExclamationCircleOutlined />,
      content: t('settings.data.s3.manager.delete.confirm.single', { fileName }),
      okText: t('settings.data.s3.manager.delete.confirm.title'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: async () => {
        setDeleting(true)
        try {
          await window.api.backup.deleteS3File(fileName, {
            ...s3Config,
            endpoint,
            region,
            bucket,
            accessKeyId,
            secretAccessKey,
            skipBackupFile: false,
            autoSync: false,
            syncInterval: 0,
            maxBackups: 0
          })
          window.message.success(t('settings.data.s3.manager.delete.success.single'))
          await fetchBackupFiles()
        } catch (error: any) {
          window.message.error(t('settings.data.s3.manager.delete.error', { message: error.message }))
        } finally {
          setDeleting(false)
        }
      }
    })
  }

  const handleRestore = async (fileName: string) => {
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      window.message.error(t('settings.data.s3.manager.config.incomplete'))
      return
    }

    window.modal.confirm({
      title: t('settings.data.s3.restore.confirm.title'),
      icon: <ExclamationCircleOutlined />,
      content: t('settings.data.s3.restore.confirm.content'),
      okText: t('settings.data.s3.restore.confirm.ok'),
      cancelText: t('settings.data.s3.restore.confirm.cancel'),
      centered: true,
      onOk: async () => {
        setRestoring(true)
        try {
          await (restoreMethod || restoreFromS3)(fileName)
          window.message.success(t('settings.data.s3.restore.success'))
          onClose() // 关闭模态框
        } catch (error: any) {
          window.message.error(t('settings.data.s3.restore.error', { message: error.message }))
        } finally {
          setRestoring(false)
        }
      }
    })
  }

  const columns = [
    {
      title: t('settings.data.s3.manager.columns.fileName'),
      dataIndex: 'fileName',
      key: 'fileName',
      ellipsis: {
        showTitle: false
      },
      render: (fileName: string) => (
        <Tooltip placement="topLeft" title={fileName}>
          {fileName}
        </Tooltip>
      )
    },
    {
      title: t('settings.data.s3.manager.columns.modifiedTime'),
      dataIndex: 'modifiedTime',
      key: 'modifiedTime',
      width: 180,
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: t('settings.data.s3.manager.columns.size'),
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (size: number) => formatFileSize(size)
    },
    {
      title: t('settings.data.s3.manager.columns.actions'),
      key: 'action',
      width: 160,
      render: (_: any, record: BackupFile) => (
        <>
          <Button type="link" onClick={() => handleRestore(record.fileName)} disabled={restoring || deleting}>
            {t('settings.data.s3.manager.restore')}
          </Button>
          <Button
            type="link"
            danger
            onClick={() => handleDeleteSingle(record.fileName)}
            disabled={deleting || restoring}>
            {t('settings.data.s3.manager.delete.label')}
          </Button>
        </>
      )
    }
  ]

  const rowSelection = {
    selectedRowKeys,
    onChange: (selectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(selectedRowKeys)
    }
  }

  return (
    <Modal
      title={t('settings.data.s3.manager.title')}
      open={visible}
      onCancel={onClose}
      width={800}
      centered
      transitionName="animation-move-down"
      footer={[
        <Button key="refresh" icon={<ReloadOutlined />} onClick={fetchBackupFiles} disabled={loading}>
          {t('settings.data.s3.manager.refresh')}
        </Button>,
        <Button
          key="delete"
          danger
          icon={<DeleteOutlined />}
          onClick={handleDeleteSelected}
          disabled={selectedRowKeys.length === 0 || deleting}
          loading={deleting}>
          {t('settings.data.s3.manager.delete.selected', { count: selectedRowKeys.length })}
        </Button>,
        <Button key="close" onClick={onClose}>
          {t('settings.data.s3.manager.close')}
        </Button>
      ]}>
      <Table
        rowKey="fileName"
        columns={columns}
        dataSource={backupFiles}
        rowSelection={rowSelection}
        pagination={pagination}
        loading={loading}
        onChange={handleTableChange}
        size="middle"
      />
    </Modal>
  )
}
