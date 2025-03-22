import {
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import ListItem from '@renderer/components/ListItem'
import TextEditPopup from '@renderer/components/Popups/TextEditPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import store from '@renderer/store'
import { FileType, FileTypes } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import type { MenuProps } from 'antd'
import { Button, Dropdown } from 'antd'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ContentView from './ContentView'

const FilesPage: FC = () => {
  const { t } = useTranslation()
  const [fileType, setFileType] = useState<string>('document')
  const { providers } = useProviders()

  const geminiProviders = providers.filter((provider) => provider.type === 'gemini')

  const tempFilesSort = (files: FileType[]) => {
    return files.sort((a, b) => {
      const aIsTemp = a.origin_name.startsWith('temp_file')
      const bIsTemp = b.origin_name.startsWith('temp_file')
      if (aIsTemp && !bIsTemp) return 1
      if (!aIsTemp && bIsTemp) return -1
      return 0
    })
  }

  const files = useLiveQuery<FileType[]>(() => {
    if (fileType === 'all') {
      return db.files.orderBy('count').toArray().then(tempFilesSort)
    }
    return db.files.where('type').equals(fileType).sortBy('count').then(tempFilesSort)
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
          {FileManager.formatFileName(file)}
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
    {
      key: FileTypes.DOCUMENT,
      icon: <FilePdfOutlined />,
      label: t('files.document')
    },
    {
      key: FileTypes.IMAGE,
      icon: <FileImageOutlined />,
      label: t('files.image')
    },
    {
      key: FileTypes.TEXT,
      icon: <FileTextOutlined />,
      label: t('files.text')
    },
    ...geminiProviders.map((provider) => ({
      key: 'gemini_' + provider.id,
      icon: <FilePdfOutlined />,
      label: provider.name
    })),
    {
      key: 'all',
      icon: <FileTextOutlined />,
      label: t('files.all')
    }
  ].filter(Boolean)

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderBlockEnd: 'none' }}>{t('files.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SideNav>
          <ScrollContainer>
            {menuItems.map((item) => (
              <ListItem
                key={item?.key}
                active={fileType === item?.key}
                icon={item?.icon}
                title={item?.label as string}
                onClick={() => setFileType(item?.key as FileTypes)}
              />
            ))}
          </ScrollContainer>
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
  border-inline-end: 0.5px solid var(--color-border);
  padding-block: 7px;
  padding-inline: 12px;
  display: flex;
  flex-direction: column;
  user-select: none;

  .ant-menu {
    border-inline-end: none !important;
    background: transparent;
  }
`
const ScrollContainer = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  flex: 1;

  > div {
    margin-bottom: 8px;

    &:last-child {
      margin-bottom: 0;
    }
  }
`

export default FilesPage
