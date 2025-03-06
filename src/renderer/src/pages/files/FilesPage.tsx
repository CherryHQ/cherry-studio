import {
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import store from '@renderer/store'
import { FileType, FileTypes } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import type { MenuProps } from 'antd'
import { Button, Dropdown, Menu } from 'antd'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ContentView from './ContentView'

const FilesPage: FC = () => {
  const { t } = useTranslation()
  const [fileType, setFileType] = useState<FileTypes | 'all' | 'gemini'>('all')
  const { providers } = useProviders()

  const geminiProviders = providers.filter((provider) => provider.type === 'gemini')

  const files = useLiveQuery<FileType[]>(() => {
    if (fileType === 'all') {
      return db.files.orderBy('count').toArray()
    }
    return db.files.where('type').equals(fileType).sortBy('count')
  }, [fileType])

  const handleDelete = async (fileId: string) => {
    const file = await FileManager.getFile(fileId)

    const paintings = await store.getState().paintings.paintings
    const paintingsFiles = paintings.flatMap((p) => p.files)

    if (paintingsFiles.some((p) => p.id === fileId)) {
      window.modal.warning({ content: t('files.delete.paintings.warning'), centered: true })
      return
    }

    if (file) {
      await FileManager.deleteFile(fileId, true)
    }

    const topics = await db.topics
      .filter((topic) => topic.messages.some((message) => message.files?.some((f) => f.id === fileId)))
      .toArray()

    if (topics.length > 0) {
      for (const topic of topics) {
        const updatedMessages = topic.messages.map((message) => ({
          ...message,
          files: message.files?.filter((f) => f.id !== fileId)
        }))
        await db.topics.update(topic.id, { messages: updatedMessages })
      }
    }
  }

  const handleRename = async (fileId: string) => {
    const file = await FileManager.getFile(fileId)
    if (file) {
      const newName = await TextEditPopup.show({ text: file.origin_name })
      if (newName) {
        FileManager.updateFile({ ...file, origin_name: newName })
      }
    }
  }

  const getActionMenu = (fileId: string): MenuProps['items'] => [
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: t('files.edit'),
      onClick: () => handleRename(fileId)
    },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: t('files.delete'),
      danger: true,
      onClick: () => {
        window.modal.confirm({
          title: t('files.delete.title'),
          content: t('files.delete.content'),
          centered: true,
          okButtonProps: { danger: true },
          onOk: () => handleDelete(fileId)
        })
      }
    }
  ]

  const dataSource = files?.map((file) => {
    return {
      key: file.id,
      file: (
        <FileNameText className="text-nowrap" onClick={() => window.api.file.openPath(file.path)}>
          {file.origin_name}
        </FileNameText>
      ),
      size: formatFileSize(file.size),
      size_bytes: file.size,
      count: file.count,
      created_at: dayjs(file.created_at).format('MM-DD HH:mm'),
      created_at_unix: dayjs(file.created_at).unix(),
      actions: (
        <Dropdown menu={{ items: getActionMenu(file.id) }} trigger={['click']} placement="bottom" arrow>
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      )
    }
  })

  const columns = useMemo(
    () => [
      {
        title: t('files.name'),
        dataIndex: 'file',
        key: 'file',
        width: '300px'
      },
      {
        title: t('files.size'),
        dataIndex: 'size',
        key: 'size',
        width: '80px',
        sorter: (a: { size_bytes: number }, b: { size_bytes: number }) => b.size_bytes - a.size_bytes,
        align: 'center'
      },
      {
        title: t('files.count'),
        dataIndex: 'count',
        key: 'count',
        width: '60px',
        sorter: (a: { count: number }, b: { count: number }) => b.count - a.count,
        align: 'center'
      },
      {
        title: t('files.created_at'),
        dataIndex: 'created_at',
        key: 'created_at',
        width: '120px',
        align: 'center',
        sorter: (a: { created_at_unix: number }, b: { created_at_unix: number }) =>
          b.created_at_unix - a.created_at_unix
      },
      {
        title: t('files.actions'),
        dataIndex: 'actions',
        key: 'actions',
        width: '80px',
        align: 'center'
      }
    ],
    [t]
  )

  const menuItems = [
    { key: 'all', label: t('files.all'), icon: <FileTextOutlined /> },
    { key: FileTypes.IMAGE, label: t('files.image'), icon: <FileImageOutlined /> },
    { key: FileTypes.TEXT, label: t('files.text'), icon: <FileTextOutlined /> },
    { key: FileTypes.DOCUMENT, label: t('files.document'), icon: <FilePdfOutlined /> },
    ...geminiProviders.map((provider) => ({
      key: 'gemini_' + provider.id,
      label: provider.name,
      icon: <FilePdfOutlined />
    }))
  ].filter(Boolean) as MenuProps['items']

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('files.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SideNav>
          <Menu selectedKeys={[fileType]} items={menuItems} onSelect={({ key }) => setFileType(key as FileTypes)} />
        </SideNav>
        <TableContainer right>
          <ContentView id={fileType} files={files} dataSource={dataSource} columns={columns} />
        </TableContainer>
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

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  min-height: 100%;
`

const TableContainer = styled(Scrollbar)`
  padding: 15px;
  display: flex;
  width: 100%;
  flex-direction: column;
`

const FileNameText = styled.div`
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
`

const SideNav = styled.div`
  width: var(--assistants-width);
  border-right: 0.5px solid var(--color-border);
  padding: 7px 12px;
  user-select: none;

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
      color: var(--color-text);
    }
  }
`

export default FilesPage
