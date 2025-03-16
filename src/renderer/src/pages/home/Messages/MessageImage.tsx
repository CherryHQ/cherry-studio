import { Message } from '@renderer/types'
import { FC } from 'react'

interface Props {
  message: Message
}

const MessageImage: FC<Props> = ({ message }) => {
  return (
    <div
      style={{
        marginTop: '10px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        maxWidth: '100%'
      }}>
      {message.metadata?.generateImage!.images.map((image, index) => (
        <div
          key={`image-container-${index}`}
          style={{
            height: '150px',
            width: 'calc(33.33% - 7px)',
            minWidth: '120px',
            padding: '5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
          }}>
          <img
            key={`image-${index}`}
            src={image}
            alt={`生成图像 ${index + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain'
            }}
          />
        </div>
      ))}
    </div>
  )
}

export default MessageImage
