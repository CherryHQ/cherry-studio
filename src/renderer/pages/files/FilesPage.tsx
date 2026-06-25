import { ExclamationCircleOutlined } from '@ant-design/icons'
import { Flex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ListItem from '@renderer/components/ListItem'
import db from '@renderer/databases'
import { getFileFieldLabelKey } from '@renderer/i18n/label'
import { handleDelete, handleRename, sortFiles, tempFilesSort } from '@renderer/services/FileAction'
import FileManager from '@renderer/services/FileManager'
import store from '@renderer/store'
import { FILE_TYPE, type FileMetadata, type FileType } from '@renderer/types/file'
import { formatFileSize } from '@renderer/utils/file'
import { cn } from '@renderer/utils/style'
import { Checkbox, Dropdown, Empty, Popconfirm } from 'antd'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDownNarrowWide,
  ArrowUpWideNarrow,
  File as FileIcon,
  FileImage,
  FileText,
  FileType as FileTypeIcon
} from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import FileList from './FileList'

type SortField = 'created_at' | 'size' | 'name'
type SortOrder = 'asc' | 'desc'

const logger = loggerService.withContext('FilesPage')

const FilesPage: FC = () => {
  const { t } = useTranslation()
  const [fileType, setFileType] = useState<FileType | 'all'>('document')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])

  useEffect(() => {
    setSelectedFileIds([])
  }, [fileType])

  const files = useLiveQuery<FileMetadata[]>(async () => {
    if (fileType === 'all') {
      return db.files.orderBy('count').toArray().then(tempFilesSort)
    }
    return db.files.where('type').equals(fileType).sortBy('count').then(tempFilesSort)
  }, [fileType])

  const sortedFiles = files ? sortFiles(files, sortField, sortOrder) : []

  const handleBatchDelete = async () => {
    const selectedFiles = await Promise.all(selectedFileIds.map((id) => FileManager.getFile(id)))
    const validFiles = selectedFiles.filter((file) => file !== null && file !== undefined)

    const paintings = store.getState().paintings
    const paintingsFiles = Object.values(paintings)
      .flat()
      .filter((painting) => painting?.files?.length > 0)
      .flatMap((painting) => painting.files)

    const filesInPaintings = validFiles.filter((file) => paintingsFiles.some((p) => p.id === file.id))

    if (filesInPaintings.length > 0) {
      window.modal.warning({
        content: t('files.delete.paintings.warning'),
        centered: true
      })
      return
    }

    await Promise.all(selectedFileIds.map((fileId) => handleDelete(fileId, t)))

    setSelectedFileIds([])
  }

  const handleSelectFile = (fileId: string, checked: boolean) => {
    if (checked) {
      setSelectedFileIds((prev) => [...prev, fileId])
    } else {
      setSelectedFileIds((prev) => prev.filter((id) => id !== fileId))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedFileIds(sortedFiles.map((file) => file.id))
    } else {
      setSelectedFileIds([])
    }
  }

  const dataSource = sortedFiles?.map((file) => {
    logger.debug('FileItem', file)
    return {
      key: file.id,
      file: (
        <span onClick={() => window.api.file.openPath(FileManager.getFilePath(file))}>
          {FileManager.formatFileName(file)}
        </span>
      ),
      size: formatFileSize(file.size),
      size_bytes: file.size,
      count: file.count,
      path: FileManager.getFilePath(file),
      ext: file.ext,
      created_at: dayjs(file.created_at).format('MM-DD HH:mm'),
      created_at_unix: dayjs(file.created_at).unix(),
      actions: (
        <Flex className="items-center gap-0 opacity-70">
          <Button variant="ghost" onClick={() => handleRename(file.id)}>
            <EditIcon size={14} />
          </Button>
          <Popconfirm
            title={t('files.delete.title')}
            description={t('files.delete.content')}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            onConfirm={() => handleDelete(file.id, t)}
            placement="left"
            icon={<ExclamationCircleOutlined style={{ color: 'red' }} />}>
            <Button variant="ghost">
              <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
            </Button>
          </Popconfirm>
          {fileType !== 'image' && (
            <Checkbox
              checked={selectedFileIds.includes(file.id)}
              onChange={(e) => handleSelectFile(file.id, e.target.checked)}
              style={{ margin: '0 8px' }}
            />
          )}
        </Flex>
      )
    }
  })

  const menuItems = [
    { key: FILE_TYPE.DOCUMENT, label: t('files.document'), icon: <FileIcon size={16} /> },
    { key: FILE_TYPE.IMAGE, label: t('files.image'), icon: <FileImage size={16} /> },
    { key: FILE_TYPE.TEXT, label: t('files.text'), icon: <FileTypeIcon size={16} /> },
    { key: 'all', label: t('files.all'), icon: <FileText size={16} /> }
  ] as const

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height))] flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('files.title')}</NavbarCenter>
      </Navbar>
      <div id="content-container" className="flex min-h-full flex-1 flex-row">
        <div className="flex w-[var(--settings-width)] select-none flex-col gap-1.5 border-[var(--color-border)] border-r-[0.5px] px-2.5 py-3 [&_.ant-menu-item-selected]:border-[0.5px] [&_.ant-menu-item-selected]:border-[var(--color-border)] [&_.ant-menu-item-selected]:bg-[var(--color-background-soft)] [&_.ant-menu-item-selected]:text-[var(--color-primary)] [&_.ant-menu-item:hover]:bg-[var(--color-background-soft)] [&_.ant-menu-item]:my-1 [&_.ant-menu-item]:h-9 [&_.ant-menu-item]:w-full [&_.ant-menu-item]:rounded-[var(--list-item-border-radius)] [&_.ant-menu-item]:border-[0.5px] [&_.ant-menu-item]:border-transparent [&_.ant-menu-item]:leading-9 [&_.ant-menu]:border-e-0! [&_.ant-menu]:bg-transparent">
          {menuItems.map((item) => (
            <ListItem
              key={item.key}
              icon={item.icon}
              title={item.label}
              active={fileType === item.key}
              onClick={() => setFileType(item.key)}
            />
          ))}
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-[var(--color-border)] border-b-[0.5px] px-4 py-2">
            <Flex className="items-center gap-2">
              {(['created_at', 'size', 'name'] as const).map((field) => (
                <Button
                  key={field}
                  variant="ghost"
                  className={cn(
                    'flex h-[30px] items-center gap-1 rounded-[var(--list-item-border-radius)] border-[0.5px] border-transparent bg-transparent px-3 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background-soft)] hover:text-[var(--color-text)] [&_.anticon]:text-xs',
                    sortField === field &&
                      'border-[var(--color-border)] bg-[var(--color-background-soft)] text-[var(--color-text)]'
                  )}
                  onClick={() => {
                    if (sortField === field) {
                      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                    } else {
                      setSortField(field)
                      setSortOrder('desc')
                    }
                  }}>
                  {t(getFileFieldLabelKey(field))}
                  {sortField === field &&
                    (sortOrder === 'desc' ? <ArrowUpWideNarrow size={12} /> : <ArrowDownNarrowWide size={12} />)}
                </Button>
              ))}
            </Flex>
            {fileType !== 'image' && (
              <Dropdown.Button
                style={{ width: 'auto' }}
                menu={{
                  items: [
                    {
                      key: 'delete',
                      disabled: selectedFileIds.length === 0,
                      danger: true,
                      label: (
                        <Popconfirm
                          disabled={selectedFileIds.length === 0}
                          title={t('files.delete.title')}
                          description={t('files.delete.content')}
                          okText={t('common.confirm')}
                          cancelText={t('common.cancel')}
                          onConfirm={handleBatchDelete}
                          icon={<ExclamationCircleOutlined style={{ color: 'red' }} />}>
                          {t('files.batch_delete')} ({selectedFileIds.length})
                        </Popconfirm>
                      )
                    }
                  ]
                }}
                trigger={['click']}>
                <Checkbox
                  indeterminate={selectedFileIds.length > 0 && selectedFileIds.length < sortedFiles.length}
                  checked={selectedFileIds.length === sortedFiles.length && sortedFiles.length > 0}
                  onChange={(e) => handleSelectAll(e.target.checked)}>
                  {t('files.batch_operation')}
                </Checkbox>
              </Dropdown.Button>
            )}
          </div>
          {dataSource && dataSource?.length > 0 ? (
            <FileList id={fileType} list={dataSource} files={sortedFiles} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      </div>
    </div>
  )
}

export default FilesPage
