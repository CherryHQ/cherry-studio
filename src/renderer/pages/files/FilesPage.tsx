import { Button, Checkbox, EmptyState, Flex } from '@cherrystudio/ui'
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

  const confirmDeleteFile = (fileId: string) => {
    void window.modal.confirm({
      title: t('files.delete.title'),
      content: t('files.delete.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      okButtonProps: { danger: true },
      onOk: () => handleDelete(fileId, t)
    })
  }

  const confirmBatchDelete = () => {
    if (selectedFileIds.length === 0) {
      return
    }

    void window.modal.confirm({
      title: t('files.delete.title'),
      content: t('files.delete.content'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      centered: true,
      okButtonProps: { danger: true },
      onOk: handleBatchDelete
    })
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
          <Button variant="ghost" onClick={() => confirmDeleteFile(file.id)}>
            <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
          </Button>
          {fileType !== 'image' && (
            <Checkbox
              className="mx-2"
              checked={selectedFileIds.includes(file.id)}
              onCheckedChange={(checked) => handleSelectFile(file.id, checked === true)}
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
                <SortButton
                  key={field}
                  active={sortField === field}
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
                </SortButton>
              ))}
            </Flex>
            {fileType !== 'image' && (
              <Flex className="items-center gap-2">
                <Checkbox
                  checked={
                    selectedFileIds.length > 0 && selectedFileIds.length < sortedFiles.length
                      ? 'indeterminate'
                      : selectedFileIds.length === sortedFiles.length && sortedFiles.length > 0
                  }
                  onCheckedChange={(checked) => handleSelectAll(checked === true)}
                />
                <span className="text-foreground-secondary text-sm">{t('files.batch_operation')}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={selectedFileIds.length === 0}
                  onClick={confirmBatchDelete}>
                  {t('files.batch_delete')} ({selectedFileIds.length})
                </Button>
              </Flex>
            )}
          </SortContainer>
          {dataSource && dataSource?.length > 0 ? (
            <FileList id={fileType} list={dataSource} files={sortedFiles} />
          ) : (
            <EmptyState preset="no-file" compact className="flex-1" />
          )}
        </MainContent>
      </ContentContainer>
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

`

const SortButton = styled(Button)<{ active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  height: 30px;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid ${(props) => (props.active ? 'var(--color-border)' : 'transparent')};
  background-color: ${(props) => (props.active ? 'var(--color-background-soft)' : 'transparent')};
  color: ${(props) => (props.active ? 'var(--color-text)' : 'var(--color-text-secondary)')};

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text);
  }
`

export default FilesPage
