import { DeleteOutlined, ExclamationCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { restoreFromWebdav } from '@renderer/services/BackupService'
import { formatFileSize } from '@renderer/utils'
import { Button, message, Modal, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface BackupFile {
  fileName: string
  modifiedTime: string
  size: number
}

interface WebdavConfig {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
}

interface WebdavBackupManagerProps {
  visible: boolean
  onClose: () => void
  webdavConfig: {
    webdavHost?: string
    webdavUser?: string
    webdavPass?: string
    webdavPath?: string
    webdavDisableStream?: boolean
  }
  restoreMethod?: (fileName: string) => Promise<void>
  customLabels?: {
    restoreConfirmTitle?: string
    restoreConfirmContent?: string
    invalidConfigMessage?: string
  }
}

export function WebdavBackupManager({
  visible,
  onClose,
  webdavConfig,
  restoreMethod,
  customLabels
}: WebdavBackupManagerProps) {
  const { t } = useTranslation()
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

  const { webdavHost, webdavUser, webdavPass, webdavPath } = webdavConfig

  const fetchBackupFiles = useCallback(async () => {
    if (!webdavHost) {
      window.message.error(t('message.error.invalid.webdav'))
      return
    }

    setLoading(true)
    try {
      const files = await window.api.backup.listWebdavFiles({
        webdavHost,
        webdavUser,
        webdavPass,
        webdavPath
      } as WebdavConfig)
      setBackupFiles(files)
      setPagination((prev) => ({
        ...prev,
        total: files.length
      }))
    } catch (error: any) {
      window.message.error(`${t('settings.data.webdav.backup.manager.fetch.error')}: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }, [webdavHost, webdavUser, webdavPass, webdavPath, t])

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
      message.warning(t('settings.data.webdav.backup.manager.select.files.delete'))
      return
    }

    if (!webdavHost) {
      window.message.error(t('message.error.invalid.webdav'))
      return
    }

    window.modal.confirm({
      title: t('settings.data.webdav.backup.manager.delete.confirm.title'),
      icon: <ExclamationCircleOutlined />,
      content: t('settings.data.webdav.backup.manager.delete.confirm.multiple', { count: selectedRowKeys.length }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: async () => {
        setDeleting(true)
        try {
          // 依次删除选中的文件
          for (const key of selectedRowKeys) {
            await window.api.backup.deleteWebdavFile(key.toString(), {
              webdavHost,
              webdavUser,
              webdavPass,
              webdavPath
            } as WebdavConfig)
          }
          window.message.success(
            t('settings.data.webdav.backup.manager.delete.success.multiple', { count: selectedRowKeys.length })
          )
          setSelectedRowKeys([])
          await fetchBackupFiles()
        } catch (error: any) {
          window.message.error(`${t('settings.data.webdav.backup.manager.delete.error')}: ${error.message}`)
        } finally {
          setDeleting(false)
        }
      }
    })
  }

  const handleDeleteSingle = async (fileName: string) => {
    if (!webdavHost) {
      window.message.error(t('message.error.invalid.webdav'))
      return
    }

    window.modal.confirm({
      title: t('settings.data.webdav.backup.manager.delete.confirm.title'),
      icon: <ExclamationCircleOutlined />,
      content: t('settings.data.webdav.backup.manager.delete.confirm.single', { fileName }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: async () => {
        setDeleting(true)
        try {
          await window.api.backup.deleteWebdavFile(fileName, {
            webdavHost,
            webdavUser,
            webdavPass,
            webdavPath
          } as WebdavConfig)
          window.message.success(t('settings.data.webdav.backup.manager.delete.success.single'))
          await fetchBackupFiles()
        } catch (error: any) {
          window.message.error(`${t('settings.data.webdav.backup.manager.delete.error')}: ${error.message}`)
        } finally {
          setDeleting(false)
        }
      }
    })
  }

  const handleRestore = async (fileName: string) => {
    if (!webdavHost) {
      window.message.error(customLabels?.invalidConfigMessage || t('message.error.invalid.webdav'))
      return
    }

    window.modal.confirm({
      title: customLabels?.restoreConfirmTitle || t('settings.data.webdav.restore.confirm.title'),
      icon: <ExclamationCircleOutlined />,
      content: customLabels?.restoreConfirmContent || t('settings.data.webdav.restore.confirm.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: async () => {
        setRestoring(true)
        try {
          await (restoreMethod || restoreFromWebdav)(fileName)
          window.message.success(t('settings.data.webdav.backup.manager.restore.success'))
          onClose() // 关闭模态框
        } catch (error: any) {
          window.message.error(`${t('settings.data.webdav.backup.manager.restore.error')}: ${error.message}`)
        } finally {
          setRestoring(false)
        }
      }
    })
  }

  const columns = [
    {
      title: t('settings.data.webdav.backup.manager.columns.fileName'),
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
      title: t('settings.data.webdav.backup.manager.columns.modifiedTime'),
      dataIndex: 'modifiedTime',
      key: 'modifiedTime',
      width: 180,
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: t('settings.data.webdav.backup.manager.columns.size'),
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (size: number) => formatFileSize(size)
    },
    {
      title: t('settings.data.webdav.backup.manager.columns.actions'),
      key: 'action',
      width: 160,
      render: (_: any, record: BackupFile) => (
        <>
          <Button type="link" onClick={() => handleRestore(record.fileName)} disabled={restoring || deleting}>
            {t('settings.data.webdav.backup.manager.restore.text')}
          </Button>
          <Button
            type="link"
            danger
            onClick={() => handleDeleteSingle(record.fileName)}
            disabled={deleting || restoring}>
            {t('settings.data.webdav.backup.manager.delete.text')}
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
      title={t('settings.data.webdav.backup.manager.title')}
      open={visible}
      onCancel={onClose}
      width={800}
      centered
      transitionName="animation-move-down"
      footer={[
        <Button key="refresh" icon={<ReloadOutlined />} onClick={fetchBackupFiles} disabled={loading}>
          {t('settings.data.webdav.backup.manager.refresh')}
        </Button>,
        <Button
          key="delete"
          danger
          icon={<DeleteOutlined />}
          onClick={handleDeleteSelected}
          disabled={selectedRowKeys.length === 0 || deleting}
          loading={deleting}>
          {t('settings.data.webdav.backup.manager.delete.selected')} ({selectedRowKeys.length})
        </Button>,
        <Button key="close" onClick={onClose}>
          {t('common.close')}
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
