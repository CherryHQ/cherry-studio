import FileManager from '@renderer/services/FileManager'
import type { FileMessageBlock } from '@renderer/types/newMessage'
import { Upload } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  block: FileMessageBlock
}

const StyledUpload = styled(Upload)`
  .ant-upload-list-item-name {
    max-width: 220px;
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
`

const MessageAttachments: FC<Props> = ({ block }) => {
  if (!block.file) {
    return null
  }

  return (
    <Container style={{ marginTop: 2, marginBottom: 8 }} className="message-attachments">
      <StyledUpload
        listType="text"
        disabled
        fileList={[
          {
            uid: block.file.id,
            url: 'file://' + FileManager.getSafePath(block.file),
            status: 'done' as const,
            name: FileManager.formatFileName(block.file)
          }
        ]}
      />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 8px;
`

export default MessageAttachments
