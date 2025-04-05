import { FileOutlined } from '@ant-design/icons'
import FileManager from '@renderer/services/FileManager'
import { FileType } from '@renderer/types'
import { ConfigProvider, Image, Tag } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useState } from 'react'
import styled from 'styled-components'

interface Props {
  files: FileType[]
  setFiles: (files: FileType[]) => void
}

const AttachmentPreview: FC<Props> = ({ files, setFiles }) => {
  const [visibleId, setVisibleId] = useState('')

  const isImage = (ext: string) => {
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)
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
            icon={<FileOutlined />}
            bordered={false}
            color="cyan"
            closable
            onClose={() => setFiles(files.filter((f) => f.id !== file.id))}>
            <FileName
              onClick={() => {
                if (isImage(file.ext)) {
                  setVisibleId(file.id)
                  return
                }
                const path = FileManager.getSafePath(file)
                if (path) {
                  window.api.file.openPath(path)
                }
              }}>
              {FileManager.formatFileName(file)}
              {isImage(file.ext) && (
                <Image
                  style={{ display: 'none' }}
                  src={'file://' + FileManager.getSafePath(file)}
                  preview={{
                    visible: visibleId === file.id,
                    src: 'file://' + FileManager.getSafePath(file),
                    onVisibleChange: (value) => {
                      setVisibleId(value ? file.id : '')
                    }
                  }}
                />
              )}
            </FileName>
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
