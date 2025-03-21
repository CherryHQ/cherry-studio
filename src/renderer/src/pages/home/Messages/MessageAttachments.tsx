import {
  CopyOutlined,
  DownloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  SwapOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons'
import FileManager from '@renderer/services/FileManager'
import { FileType, FileTypes, Message } from '@renderer/types'
import { download } from '@renderer/utils/download'
import { Image as AntdImage, Space, Upload } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  message: Message
}

const MessageAttachments: FC<Props> = ({ message }) => {
  const handleCopyImage = async (image: FileType) => {
    const data = await FileManager.readFile(image)
    const blob = new Blob([data], { type: 'image/png' })
    const item = new ClipboardItem({ [blob.type]: blob })
    await navigator.clipboard.write([item])
  }

  if (!message.files) {
    return null
  }

  if (message?.files && message.files[0]?.type === FileTypes.IMAGE) {
    return (
      <Container style={{ marginBottom: 8 }}>
        {message.files?.map((image) => (
          <Image
            src={FileManager.getFileUrl(image)}
            key={image.id}
            width="33%"
            preview={{
              toolbarRender: (
                _,
                {
                  transform: { scale },
                  actions: { onFlipY, onFlipX, onRotateLeft, onRotateRight, onZoomOut, onZoomIn, onReset }
                }
              ) => (
                <ToobarWrapper size={12} className="toolbar-wrapper">
                  <SwapOutlined rotate={90} onClick={onFlipY} />
                  <SwapOutlined onClick={onFlipX} />
                  <RotateLeftOutlined onClick={onRotateLeft} />
                  <RotateRightOutlined onClick={onRotateRight} />
                  <ZoomOutOutlined disabled={scale === 1} onClick={onZoomOut} />
                  <ZoomInOutlined disabled={scale === 50} onClick={onZoomIn} />
                  <UndoOutlined onClick={onReset} />
                  <CopyOutlined onClick={() => handleCopyImage(image)} />
                  <DownloadOutlined onClick={() => download(FileManager.getFileUrl(image))} />
                </ToobarWrapper>
              )
            }}
          />
        ))}
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

const ToobarWrapper = styled(Space)`
  padding: 0px 24px;
  color: #fff;
  font-size: 20px;
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 100px;
  .anticon {
    padding: 12px;
    cursor: pointer;
  }
  .anticon:hover {
    opacity: 0.3;
  }
`

export default MessageAttachments
