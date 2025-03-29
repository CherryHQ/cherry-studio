import {
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
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
import { Button, Empty, Flex, Menu, Popconfirm } from 'antd'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import FileList from './FileList'

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

  const dataSource = files?.map((file) => {
    return {
      key: file.id,
      file: <span onClick={() => window.api.file.openPath(file.path)}>{FileManager.formatFileName(file)}</span>,
      size: formatFileSize(file.size),
      size_bytes: file.size,
      count: file.count,
      path: file.path,
      ext: file.ext,
      created_at: dayjs(file.created_at).format('MM-DD HH:mm'),
      created_at_unix: dayjs(file.created_at).unix(),
      actions: (
        <Flex align="center" gap={0} style={{ opacity: 0.7 }}>
          <Button type="text" icon={<EditOutlined />} onClick={() => handleRename(file.id)} />
          <Popconfirm
            title={t('files.delete.title')}
            description={t('files.delete.content')}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            onConfirm={() => handleDelete(file.id)}
            icon={<ExclamationCircleOutlined style={{ color: 'red' }} />}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Flex>
      )
    }
  })

  const menuItems = [
    { key: FileTypes.DOCUMENT, label: t('files.document'), icon: <FilePdfOutlined /> },
    { key: FileTypes.IMAGE, label: t('files.image'), icon: <FileImageOutlined /> },
    { key: FileTypes.TEXT, label: t('files.text'), icon: <FileTextOutlined /> },
    ...geminiProviders.map((provider) => ({
      key: 'gemini_' + provider.id,
      label: provider.name,
      icon: <FilePdfOutlined />
    })),
    { key: 'all', label: t('files.all'), icon: <FileTextOutlined /> }
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
        <ScrollContainer right>
          {dataSource && dataSource?.length > 0 ? (
            <FileList id={fileType} list={dataSource} files={files} />
          ) : (
            <Empty />
          )}
        </ScrollContainer>
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

const ScrollContainer = styled(Scrollbar)`
  padding: 16px;
  width: 100%;
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
