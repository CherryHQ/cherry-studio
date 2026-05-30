import type { ColumnDef } from '@cherrystudio/ui'
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Tooltip
} from '@cherrystudio/ui'
import { restoreFromWebdav } from '@renderer/services/BackupService'
import { formatFileSize } from '@renderer/utils'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, CircleAlert, RefreshCw, Trash2 } from 'lucide-react'
import type { Key } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

const PAGE_SIZE = 5

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
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const { webdavHost, webdavUser, webdavPass, webdavPath } = webdavConfig

  const fetchBackupFiles = useCallback(async () => {
    if (!webdavHost) {
      window.toast.error(t('message.error.invalid.webdav'))
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
    } catch (error: any) {
      window.toast.error(`${t('settings.data.webdav.backup.manager.fetch.error')}: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }, [webdavHost, webdavUser, webdavPass, webdavPath, t])

  useEffect(() => {
    if (visible) {
      void fetchBackupFiles()
      setSelectedRowKeys([])
      setCurrentPage(1)
    }
  }, [visible, fetchBackupFiles])

  const totalPages = Math.max(1, Math.ceil(backupFiles.length / PAGE_SIZE))
  const safeCurrentPage = Math.min(currentPage, totalPages)

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages))
  }, [totalPages])

  const paginatedBackupFiles = useMemo(() => {
    const start = (safeCurrentPage - 1) * PAGE_SIZE
    return backupFiles.slice(start, start + PAGE_SIZE)
  }, [backupFiles, safeCurrentPage])

  const currentPageKeys = useMemo(
    () => new Set(paginatedBackupFiles.map((file) => file.fileName)),
    [paginatedBackupFiles]
  )

  const handleSelectionChange = useCallback(
    (nextSelectedRowKeys: Key[]) => {
      setSelectedRowKeys((previousKeys) => {
        const preservedKeys = previousKeys.filter((key) => !currentPageKeys.has(key.toString()))
        return Array.from(new Set([...preservedKeys, ...nextSelectedRowKeys]))
      })
    },
    [currentPageKeys]
  )

  const handleDeleteSelected = async () => {
    if (selectedRowKeys.length === 0) {
      window.toast.warning(t('settings.data.webdav.backup.manager.select.files.delete'))
      return
    }

    if (!webdavHost) {
      window.toast.error(t('message.error.invalid.webdav'))
      return
    }

    window.modal.confirm({
      title: t('settings.data.webdav.backup.manager.delete.confirm.title'),
      icon: <CircleAlert />,
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
          window.toast.success(
            t('settings.data.webdav.backup.manager.delete.success.multiple', { count: selectedRowKeys.length })
          )
          setSelectedRowKeys([])
          await fetchBackupFiles()
        } catch (error: any) {
          window.toast.error(`${t('settings.data.webdav.backup.manager.delete.error')}: ${error.message}`)
        } finally {
          setDeleting(false)
        }
      }
    })
  }

  const handleDeleteSingle = async (fileName: string) => {
    if (!webdavHost) {
      window.toast.error(t('message.error.invalid.webdav'))
      return
    }

    window.modal.confirm({
      title: t('settings.data.webdav.backup.manager.delete.confirm.title'),
      icon: <CircleAlert />,
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
          window.toast.success(t('settings.data.webdav.backup.manager.delete.success.single'))
          await fetchBackupFiles()
        } catch (error: any) {
          window.toast.error(`${t('settings.data.webdav.backup.manager.delete.error')}: ${error.message}`)
        } finally {
          setDeleting(false)
        }
      }
    })
  }

  const handleRestore = async (fileName: string) => {
    if (!webdavHost) {
      window.toast.error(customLabels?.invalidConfigMessage || t('message.error.invalid.webdav'))
      return
    }

    window.modal.confirm({
      title: customLabels?.restoreConfirmTitle || t('settings.data.webdav.restore.confirm.title'),
      icon: <CircleAlert />,
      content: customLabels?.restoreConfirmContent || t('settings.data.webdav.restore.confirm.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: async () => {
        setRestoring(true)
        try {
          await (restoreMethod || restoreFromWebdav)(fileName)
          window.toast.success(t('settings.data.webdav.backup.manager.restore.success'))
          onClose() // 关闭模态框
        } catch (error: any) {
          window.toast.error(`${t('settings.data.webdav.backup.manager.restore.error')}: ${error.message}`)
        } finally {
          setRestoring(false)
        }
      }
    })
  }

  const columns: ColumnDef<BackupFile>[] = [
    {
      accessorKey: 'fileName',
      header: t('settings.data.webdav.backup.manager.columns.fileName'),
      meta: { width: 'calc(100% - 460px)', className: 'min-w-0' },
      cell: ({ getValue }) => {
        const fileName = getValue() as string
        return (
          <Tooltip placement="top-start" content={fileName}>
            <span className="block truncate">{fileName}</span>
          </Tooltip>
        )
      }
    },
    {
      accessorKey: 'modifiedTime',
      header: t('settings.data.webdav.backup.manager.columns.modifiedTime'),
      meta: { width: 180 },
      cell: ({ getValue }) => dayjs(getValue() as string).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      accessorKey: 'size',
      header: t('settings.data.webdav.backup.manager.columns.size'),
      meta: { width: 120 },
      cell: ({ getValue }) => formatFileSize(getValue() as number)
    },
    {
      id: 'action',
      header: t('settings.data.webdav.backup.manager.columns.actions'),
      meta: { width: 160 },
      cell: ({ row }) => {
        const record = row.original
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => handleRestore(record.fileName)} disabled={restoring || deleting}>
              {t('settings.data.webdav.backup.manager.restore.text')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => handleDeleteSingle(record.fileName)}
              disabled={deleting || restoring}>
              {t('settings.data.webdav.backup.manager.delete.text')}
            </Button>
          </div>
        )
      }
    }
  ]

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>{t('settings.data.webdav.backup.manager.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="relative">
            <DataTable
              rowKey="fileName"
              columns={columns}
              data={paginatedBackupFiles}
              selection={{
                type: 'multiple',
                selectedRowKeys,
                onChange: handleSelectionChange
              }}
              emptyText={loading ? t('common.loading') : t('common.no_results')}
              tableLayout="fixed"
            />
            {loading && backupFiles.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60">
                <Spinner text={t('common.loading')} />
              </div>
            )}
          </div>
          {backupFiles.length > PAGE_SIZE && (
            <div className="flex items-center justify-end gap-2 text-muted-foreground text-sm">
              <span>
                {safeCurrentPage} / {totalPages}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('common.previous')}
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('common.next')}
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={fetchBackupFiles} disabled={loading}>
            <RefreshCw className="size-4" />
            {t('settings.data.webdav.backup.manager.refresh')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDeleteSelected}
            disabled={selectedRowKeys.length === 0 || deleting}>
            <Trash2 className="size-4" />
            {t('settings.data.webdav.backup.manager.delete.selected')} ({selectedRowKeys.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
