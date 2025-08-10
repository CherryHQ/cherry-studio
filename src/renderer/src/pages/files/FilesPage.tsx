import { ExclamationCircleOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ListItem from '@renderer/components/ListItem'
import db from '@renderer/databases'
import { getFileFieldLabel } from '@renderer/i18n/label'
import { handleDelete, handleRename, sortFiles, tempFilesSort } from '@renderer/services/FileAction'
import FileManager from '@renderer/services/FileManager'
import { FileMetadata, FileTypes } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { Button, Empty, Flex, Popconfirm } from 'antd'
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
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import FileList from './FileList'

type SortField = 'created_at' | 'size' | 'name'
type SortOrder = 'asc' | 'desc'

const FilesPage: FC = () => {
  const { t } = useTranslation()
  const [fileType, setFileType] = useState<string>('document')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const files = useLiveQuery<FileMetadata[]>(() => {
    if (fileType === 'all') {
      return db.files.orderBy('count').toArray().then(tempFilesSort)
    }
    return db.files.where('type').equals(fileType).sortBy('count').then(tempFilesSort)
  }, [fileType])

  const sortedFiles = files ? sortFiles(files, sortField, sortOrder) : []

  const dataSource = sortedFiles?.map((file) => {
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
        <Flex align="center" gap={0} style={{ opacity: 0.7 }}>
          <Button type="text" icon={<EditIcon size={14} />} onClick={() => handleRename(file.id)} />
          <Popconfirm
            title={t('files.delete.title')}
            description={t('files.delete.content')}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            onConfirm={() => handleDelete(file.id, t)}
            placement="left"
            icon={<ExclamationCircleOutlined style={{ color: 'red' }} />}>
            <Button type="text" danger icon={<DeleteIcon size={14} className="lucide-custom" />} />
          </Popconfirm>
        </Flex>
      )
    }
  })

  const menuItems = [
    { key: FileTypes.DOCUMENT, label: t('files.document'), icon: <FileIcon size={16} /> },
    { key: FileTypes.IMAGE, label: t('files.image'), icon: <FileImage size={16} /> },
    { key: FileTypes.TEXT, label: t('files.text'), icon: <FileTypeIcon size={16} /> },
    { key: 'all', label: t('files.all'), icon: <FileText size={16} /> }
  ]

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
              onClick={() => setFileType(item.key as FileTypes)}
            />
          ))}
        </SideNav>
        <MainContent>
          <SortContainer>
            {(['created_at', 'size', 'name'] as const).map((field) => (
              <SortButton
                key={field}
                active={sortField === field}
                onClick={() => {
                  if (sortField === field) {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  } else {
                    setSortField(field as 'created_at' | 'size' | 'name')
                    setSortOrder('desc')
                  }
                }}>
                {getFileFieldLabel(field)}
                {sortField === field &&
                  (sortOrder === 'desc' ? <ArrowUpWideNarrow size={12} /> : <ArrowDownNarrowWide size={12} />)}
              </SortButton>
            ))}
          </SortContainer>
          {dataSource && dataSource?.length > 0 ? (
            <FileList id={fileType} list={dataSource} files={sortedFiles} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
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

  .anticon {
    font-size: 12px;
  }
`

export default FilesPage
