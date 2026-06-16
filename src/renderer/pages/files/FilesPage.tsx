import {
  Button,
  Checkbox,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Flex
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ListItem from '@renderer/components/ListItem'
import db from '@renderer/databases'
import { getFileFieldLabelKey } from '@renderer/i18n/label'
import { handleDelete, handleRename, sortFiles, tempFilesSort } from '@renderer/services/FileAction'
import FileManager from '@renderer/services/FileManager'
import store from '@renderer/store'
import type { FileMetadata, FileType } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDownNarrowWide,
  ArrowUpWideNarrow,
  ChevronDown,
  File as FileIcon,
  FileImage,
  FileText,
  FileType as FileTypeIcon
} from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
  const [pendingDelete, setPendingDelete] = useState<{ type: 'single'; id: string } | { type: 'batch' } | null>(null)

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
          <Button variant="ghost" onClick={() => setPendingDelete({ type: 'single', id: file.id })}>
            <DeleteIcon size={14} className="lucide-custom text-destructive" />
          </Button>
          {fileType !== 'image' && (
            <Checkbox
              checked={selectedFileIds.includes(file.id)}
              onCheckedChange={(checked) => handleSelectFile(file.id, checked === true)}
              className="mx-2"
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
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('files.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SideNav>
          {menuItems.map((item) => (
            <ListItem
              key={item.key}
              icon={item.icon}
              title={item.label}
              active={fileType === item.key}
              onClick={() => setFileType(item.key)}
            />
          ))}
        </SideNav>
        <MainContent>
          <SortContainer>
            <Flex className="items-center gap-2">
              {(['created_at', 'size', 'name'] as const).map((field) => (
                <Button
                  key={field}
                  variant={sortField === field ? 'default' : 'ghost'}
                  size="sm"
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
              <Flex className="items-center gap-1">
                <Flex className="items-center gap-2 text-sm">
                  <Checkbox
                    checked={
                      sortedFiles.length > 0 && selectedFileIds.length === sortedFiles.length
                        ? true
                        : selectedFileIds.length > 0
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={(checked) => handleSelectAll(checked === true)}
                  />
                  <span>{t('files.batch_operation')}</span>
                </Flex>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t('files.batch_operation')}>
                      <ChevronDown size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={selectedFileIds.length === 0}
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setPendingDelete({ type: 'batch' })}>
                      {t('files.batch_delete')} ({selectedFileIds.length})
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Flex>
            )}
          </SortContainer>
          {dataSource && dataSource?.length > 0 ? (
            <FileList id={fileType} list={dataSource} files={sortedFiles} />
          ) : (
            <EmptyState preset="no-file" />
          )}
        </MainContent>
      </ContentContainer>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t('files.delete.title')}
        description={t('files.delete.content')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (pendingDelete?.type === 'single') {
            await handleDelete(pendingDelete.id, t)
          } else if (pendingDelete?.type === 'batch') {
            await handleBatchDelete()
          }
          setPendingDelete(null)
        }}
      />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
`

const MainContent = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
`

const SortContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 0.5px solid var(--color-border);
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  min-height: 100%;
`

const SideNav = styled.div`
  display: flex;
  flex-direction: column;
  width: var(--settings-width);
  border-right: 0.5px solid var(--color-border);
  padding: 12px 10px;
  user-select: none;
  gap: 6px;

  .ant-menu {
    border-inline-end: none !important;
    background: transparent;
  }

  .ant-menu-item {
    height: 36px;
    line-height: 36px;
    margin: 4px 0;
    width: 100%;
    border-radius: var(--list-item-border-radius);
    border: 0.5px solid transparent;

    &:hover {
      background-color: var(--color-background-soft) !important;
    }

    &.ant-menu-item-selected {
      background-color: var(--color-background-soft);
      color: var(--color-primary);
      border: 0.5px solid var(--color-border);
    }
  }
`

export default FilesPage
