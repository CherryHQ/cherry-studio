import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { VStack } from '@renderer/components/Layout'
import db from '@renderer/databases'
import FileManager from '@renderer/services/file'
import { FileType, FileTypes } from '@renderer/types'
import { Image, Table } from 'antd'
import dayjs from 'dayjs'
import { useLiveQuery } from 'dexie-react-hooks'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const FilesPage: FC = () => {
  const { t } = useTranslation()
  const files = useLiveQuery<FileType[]>(() => db.files.orderBy('created_at').reverse().toArray())

  const dataSource = files?.map((file) => {
    const isImage = file.type === FileTypes.IMAGE
    const ImageView = <Image src={'file://' + file.path} preview={false} style={{ maxHeight: '40px' }} />
    return {
      key: file.id,
      file: isImage ? ImageView : <FileNameText className="text-nowrap">{file.origin_name}</FileNameText>,
      name: <a href={'file://' + FileManager.getSafePath(file)}>{file.origin_name}</a>,
      size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      count: file.count,
      created_at: dayjs(file.created_at).format('MM-DD HH:mm')
    }
  })

  const columns = [
    {
      title: t('files.file'),
      dataIndex: 'file',
      key: 'file',
      width: '300px'
    },
    {
      title: t('files.name'),
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: t('files.size'),
      dataIndex: 'size',
      key: 'size',
      width: '100px'
    },
    {
      title: t('files.count'),
      dataIndex: 'count',
      key: 'count',
      width: '100px'
    },
    {
      title: t('files.created_at'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: '120px'
    }
  ]

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('files.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <VStack style={{ flex: 1 }}>
          <Table dataSource={dataSource} columns={columns} style={{ width: '100%', height: '100%' }} size="small" />
        </VStack>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  height: 100%;
  overflow-y: scroll;
  padding: 20px;
`

const FileNameText = styled.div`
  font-size: 14px;
  color: var(--color-text);
  max-width: 300px;
`

export default FilesPage
