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
import { ipcApi } from '@renderer/ipc'
import {
  type BackupDestinationId,
  deleteDestinationBackup,
  listDestinationBackups,
  prepareRestoreFromDestination
} from '@renderer/services/backupDestination'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatFileSize } from '@renderer/utils/file'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, CircleAlert, RefreshCw, Trash2 } from 'lucide-react'
import type { Key } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface BackupFile {
  name: string
  modifiedAt: number
  size: number
}

interface S3BackupManagerProps {
  visible: boolean
  onClose: () => void
  destination: BackupDestinationId
}

const PAGE_SIZE = 5

export function S3BackupManager({ visible, onClose, destination }: S3BackupManagerProps) {
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const { t } = useTranslation()

  const fetchBackupFiles = useCallback(async () => {
    setLoading(true)
    try {
      const files = await listDestinationBackups(destination)
      setBackupFiles(files)
    } catch (error: any) {
      toast.error(t('settings.data.s3.manager.files.fetch.error', { message: error.message }))
    } finally {
      setLoading(false)
    }
  }, [destination, t])

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

  const currentPageKeys = useMemo(() => new Set(paginatedBackupFiles.map((file) => file.name)), [paginatedBackupFiles])

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
      toast.warning(t('settings.data.s3.manager.select.warning'))
      return
    }

    const confirmed = await popup.confirm({
      title: t('settings.data.s3.manager.delete.confirm.title'),
      icon: <CircleAlert />,
      content: t('settings.data.s3.manager.delete.confirm.multiple', { count: selectedRowKeys.length }),
      okText: t('settings.data.s3.manager.delete.confirm.title'),
      cancelText: t('common.cancel'),
      centered: true
    })
    if (!confirmed) return

    setDeleting(true)
    try {
      // 依次删除选中的文件
      for (const key of selectedRowKeys) {
        await deleteDestinationBackup(destination, key.toString())
      }
      toast.success(t('settings.data.s3.manager.delete.success.multiple', { count: selectedRowKeys.length }))
      setSelectedRowKeys([])
      await fetchBackupFiles()
    } catch (error: any) {
      toast.error(t('settings.data.s3.manager.delete.error', { message: error.message }))
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteSingle = async (fileName: string) => {
    const confirmed = await popup.confirm({
      title: t('settings.data.s3.manager.delete.confirm.title'),
      icon: <CircleAlert />,
      content: t('settings.data.s3.manager.delete.confirm.single', { fileName }),
      okText: t('settings.data.s3.manager.delete.confirm.title'),
      cancelText: t('common.cancel'),
      centered: true
    })
    if (!confirmed) return

    setDeleting(true)
    try {
      await deleteDestinationBackup(destination, fileName)
      toast.success(t('settings.data.s3.manager.delete.success.single'))
      await fetchBackupFiles()
    } catch (error: any) {
      toast.error(t('settings.data.s3.manager.delete.error', { message: error.message }))
    } finally {
      setDeleting(false)
    }
  }

  const handleRestore = async (fileName: string) => {
    setRestoring(true)
    try {
      // Confirm only after preparation, which is what rejects an unusable archive.
      const result = await prepareRestoreFromDestination(destination, fileName)
      if (result.status === 'canceled') return

      const confirmed = await popup.confirm({
        title: t('settings.data.s3.restore.confirm.title'),
        icon: <CircleAlert />,
        content: t('settings.data.s3.restore.confirm.content'),
        okText: t('settings.data.s3.restore.confirm.ok'),
        cancelText: t('settings.data.s3.restore.confirm.cancel'),
        centered: true
      })
      if (!confirmed) {
        // An abandoned preparation stays in the journal and blocks the next restore.
        await ipcApi.request('backup.cancel_restore')
        return
      }

      await ipcApi.request('backup.arm_restore', { restoreId: result.preview.restoreId })
      toast.success(t('settings.data.s3.restore.success'))
      onClose() // 关闭模态框
    } catch (error: any) {
      toast.error(t('settings.data.s3.restore.error', { message: error.message }))
    } finally {
      setRestoring(false)
    }
  }

  const columns: ColumnDef<BackupFile>[] = [
    {
      accessorKey: 'name',
      header: t('settings.data.s3.manager.columns.fileName'),
      meta: { width: 'calc(100% - 504px)', className: 'min-w-0' },
      cell: ({ getValue }) => {
        const fileName = getValue() as string
        return (
          <Tooltip placement="top-start" content={fileName} fullWidthTrigger>
            <span className="block w-full min-w-0 truncate">{fileName}</span>
          </Tooltip>
        )
      }
    },
    {
      accessorKey: 'modifiedAt',
      header: t('settings.data.s3.manager.columns.modifiedTime'),
      meta: { width: 180 },
      cell: ({ getValue }) => dayjs(getValue() as number).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      accessorKey: 'size',
      header: t('settings.data.s3.manager.columns.size'),
      meta: { width: 120 },
      cell: ({ getValue }) => formatFileSize(getValue() as number)
    },
    {
      id: 'action',
      header: t('settings.data.s3.manager.columns.actions'),
      meta: { width: 160 },
      cell: ({ row }) => {
        const record = row.original
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => handleRestore(record.name)} disabled={restoring || deleting}>
              {t('settings.data.s3.manager.restore')}
            </Button>
            <Button variant="ghost" onClick={() => handleDeleteSingle(record.name)} disabled={deleting || restoring}>
              {t('settings.data.s3.manager.delete.label')}
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
          <DialogTitle>{t('settings.data.s3.manager.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="relative">
            <DataTable
              rowKey="name"
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
            {t('settings.data.s3.manager.refresh')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDeleteSelected}
            disabled={selectedRowKeys.length === 0 || deleting}>
            <Trash2 className="size-4" />
            {t('settings.data.s3.manager.delete.selected', { count: selectedRowKeys.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
