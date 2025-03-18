import FileManager from '@renderer/services/FileManager'
import { FileTypes, Message } from '@renderer/types'
import { Image as AntdImage, Upload } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  message: Message
}

const MessageAttachments: FC<Props> = ({ message }) => {
  if (!message.files) {
    return null
  }

  if (message?.files && message.files[0]?.type === FileTypes.IMAGE) {
    return (
      <Container style={{ marginBottom: 8 }}>
        {message.files?.map((image) => <Image src={FileManager.getFileUrl(image)} key={image.id} width="33%" />)}
      </Container>
    )
  }

  return (
    <Container style={{ marginTop: 2, marginBottom: 8 }} className="message-attachments">
      <Upload
        listType="text"
        disabled
        fileList={message.files?.map((file) => ({
          uid: file.id,
          url: 'file://' + FileManager.getSafePath(file),
          status: 'done',
          name: FileManager.formatFileName(file)
        }))}
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

const Image = styled(AntdImage)`
  border-radius: 10px;
`

export default MessageAttachments
