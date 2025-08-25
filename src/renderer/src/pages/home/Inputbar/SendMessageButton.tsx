import { FC, MouseEvent } from 'react'

interface Props {
  disabled: boolean
  sendMessage: () => void
  onPause?: () => void
}

const SendMessageButton: FC<Props> = ({ disabled, sendMessage, onPause }) => {
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    onPause?.()
  }
  return (
    <i
      className="iconfont icon-ic_send"
      onClick={sendMessage}
      onContextMenu={handleContextMenu}
      style={{
        cursor: 'pointer',
        color: disabled ? 'var(--color-text-3)' : 'var(--color-primary)',
        fontSize: 22,
        transition: 'all 0.2s',
        marginTop: 1,
        marginRight: 2
      }}
    />
  )
}

export default SendMessageButton
