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
  // const handleCopyImage = async (image: FileMetadata) => {
  //   const data = await FileManager.readFile(image)
  //   const blob = new Blob([data], { type: 'image/png' })
  //   const item = new ClipboardItem({ [blob.type]: blob })
  //   await navigator.clipboard.write([item])
  // }

  if (!block.file) {
    return null
  }
  // 由图片块代替
  // if (block.file.type === FileTypes.IMAGE) {
  //   return (
  //     <Container style={{ marginBottom: 8 }}>
  //       <Image
  //         src={FileManager.getFileUrl(block.file)}
  //         key={block.file.id}
  //         width="33%"
  //         preview={{
  //           toolbarRender: (
  //             _,
  //             {
  //               transform: { scale },
  //               actions: { onFlipY, onFlipX, onRotateLeft, onRotateRight, onZoomOut, onZoomIn, onReset }
  //             }
  //           ) => (
  //             <ToobarWrapper size={12} className="toolbar-wrapper">
  //               <SwapOutlined rotate={90} onClick={onFlipY} />
  //               <SwapOutlined onClick={onFlipX} />
  //               <RotateLeftOutlined onClick={onRotateLeft} />
  //               <RotateRightOutlined onClick={onRotateRight} />
  //               <ZoomOutOutlined disabled={scale === 1} onClick={onZoomOut} />
  //               <ZoomInOutlined disabled={scale === 50} onClick={onZoomIn} />
  //               <UndoOutlined onClick={onReset} />
  //               <CopyOutlined onClick={() => handleCopyImage(block.file)} />
  //               <DownloadOutlined onClick={() => download(FileManager.getFileUrl(block.file))} />
  //             </ToobarWrapper>
  //           )
  //         }}
  //       />
  //     </Container>
  //   )
  // }

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

// const Image = styled(AntdImage)`
//   border-radius: 10px;
// `

// const ToobarWrapper = styled(Space)`
//   padding: 0px 24px;
//   color: #fff;
//   font-size: 20px;
//   background-color: rgba(0, 0, 0, 0.1);
//   border-radius: 100px;
//   .anticon {
//     padding: 12px;
//     cursor: pointer;
//   }
//   .anticon:hover {
//     opacity: 0.3;
//   }
// `

export default MessageAttachments
