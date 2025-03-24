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
import { Message } from '@renderer/types'
import { Image as AntdImage, Space } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  message: Message
}

const MessageImage: FC<Props> = ({ message }) => {
  const { t } = useTranslation()

  const onDownload = (imageBase64: string, index: number) => {
    try {
      const link = document.createElement('a')
      link.href = imageBase64
      link.download = `image-${Date.now()}-${index}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.message.success(t('message.download.success'))
    } catch (error) {
      console.error('下载图片失败:', error)
      window.message.error(t('message.download.failed'))
    }
  }

  // 复制 base64 图片到剪贴板
  const onCopy = async (imageBase64: string) => {
    try {
      const base64Data = imageBase64.split(',')[1]
      const mimeType = imageBase64.split(';')[0].split(':')[1]

      const byteCharacters = atob(base64Data)
      const byteArrays: Uint8Array[] = []

      for (let i = 0; i < byteCharacters.length; i += 512) {
        const slice = byteCharacters.slice(i, i + 512)

        const byteNumbers = new Array(slice.length)
        for (let j = 0; j < slice.length; j++) {
          byteNumbers[j] = slice.charCodeAt(j)
        }

        const byteArray = new Uint8Array(byteNumbers)
        byteArrays.push(byteArray)
      }

      const blob = new Blob(byteArrays, { type: mimeType })

      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ])

      window.message.success(t('message.copy.success'))
    } catch (error) {
      console.error('复制图片失败:', error)
      window.message.error(t('message.copy.failed'))
    }
  }

  return (
    <Container style={{ marginBottom: 8 }}>
      {message.metadata?.generateImage!.images.map((image, index) => (
        <Image
          src={image}
          key={`image-${index}`}
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
                <CopyOutlined onClick={() => onCopy(image)} />
                <DownloadOutlined onClick={() => onDownload(image, index)} />
              </ToobarWrapper>
            )
          }}
        />
      ))}
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

export default MessageImage
