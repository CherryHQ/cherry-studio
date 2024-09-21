import FileManager from '@renderer/services/file'
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
      <Container>
        {message.files?.map((image) => <Image src={'file://' + image.path} key={image.id} width="33%" />)}
      </Container>
    )
  }

  return (
    <Container style={{ marginTop: 2, marginBottom: 8 }}>
      <Upload
        listType="picture"
        disabled
        fileList={message.files?.map((file) => ({
          uid: file.id,
          url: 'file://' + FileManager.getSafePath(file),
          status: 'done',
          name: file.origin_name
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
