import {
  FileExcelFilled,
  FileImageFilled,
  FileMarkdownFilled,
  FilePdfFilled,
  FilePptFilled,
  FileTextFilled,
  FileUnknownFilled,
  FileWordFilled,
  FileZipFilled,
  FolderOpenFilled,
  GlobalOutlined,
  LinkOutlined
} from '@ant-design/icons'
import FileManager from '@renderer/services/FileManager'
import { FileType } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { ConfigProvider, Flex, Image, Tag, Tooltip } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useState } from 'react'
import styled from 'styled-components'

interface Props {
  files: FileType[]
  setFiles: (files: FileType[]) => void
}

const FileNameRender: FC<{ file: FileType }> = ({ file }) => {
  const [visible, setVisible] = useState<boolean>(false)
  const isImage = (ext: string) => {
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)
  }

  return (
    <Tooltip
      color="#46c5ca"
      fresh
      title={
        <Flex vertical gap={2} align="center">
          {isImage(file.ext) && (
            <Image
              style={{ width: 80, maxHeight: 200 }}
              src={'file://' + FileManager.getSafePath(file)}
              preview={{
                visible: visible,
                src: 'file://' + FileManager.getSafePath(file),
                onVisibleChange: setVisible
              }}
            />
          )}
          {formatFileSize(file.size)}
        </Flex>
      }>
      <FileName
        onClick={() => {
          if (isImage(file.ext)) {
            setVisible(true)
            return
          }
          const path = FileManager.getSafePath(file)
          if (path) {
            window.api.file.openPath(path)
          }
        }}>
        {FileManager.formatFileName(file)}
      </FileName>
    </Tooltip>
  )
}

const AttachmentPreview: FC<Props> = ({ files, setFiles }) => {
  const getFileIcon = (type?: string) => {
    if (!type) return <FileUnknownFilled />

    const ext = type.toLowerCase()

    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
      return <FileImageFilled />
    }

    if (['.doc', '.docx'].includes(ext)) {
      return <FileWordFilled />
    }
    if (['.xls', '.xlsx'].includes(ext)) {
      return <FileExcelFilled />
    }
    if (['.ppt', '.pptx'].includes(ext)) {
      return <FilePptFilled />
    }
    if (ext === '.pdf') {
      return <FilePdfFilled />
    }
    if (['.md', '.markdown'].includes(ext)) {
      return <FileMarkdownFilled />
    }

    if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
      return <FileZipFilled />
    }

    if (['.txt', '.json', '.log', '.yml', '.yaml', '.xml', '.csv'].includes(ext)) {
      return <FileTextFilled />
    }

    if (['.url'].includes(ext)) {
      return <LinkOutlined />
    }

    if (['.sitemap'].includes(ext)) {
      return <GlobalOutlined />
    }

    if (['.folder'].includes(ext)) {
      return <FolderOpenFilled />
    }

    return <FileUnknownFilled />
  }

  if (isEmpty(files)) {
    return null
  }

  return (
    <ContentContainer>
      <ConfigProvider
        theme={{
          components: {
            Tag: {
              borderRadiusSM: 100
            }
          }
        }}>
        {files.map((file) => (
          <Tag
            key={file.id}
            icon={getFileIcon(file.ext)}
            bordered={false}
            color="#46c5ca"
            closable
            onClose={() => setFiles(files.filter((f) => f.id !== file.id))}>
            <FileNameRender file={file} />
          </Tag>
        ))}
      </ConfigProvider>
    </ContentContainer>
  )
}

const ContentContainer = styled.div`
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 0;
  padding: 5px 15px 0 10px;
`

const FileName = styled.span`
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`

export default AttachmentPreview
