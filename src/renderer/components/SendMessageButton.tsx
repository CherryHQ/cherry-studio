import type { FC, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  disabled: boolean
  onDisabledClick?: () => void
  sendMessage: () => void
}

const SendMessageButton: FC<Props> = ({ disabled, onDisabledClick, sendMessage }) => {
  const { t } = useTranslation()

  const handleClick = () => {
    if (disabled) {
      onDisabledClick?.()
      return
    }
    sendMessage()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return

    e.preventDefault()
    if (disabled) {
      onDisabledClick?.()
      return
    }

    sendMessage()
  }

  return (
    <i
      data-ui="chat.composer.action.send"
      className="iconfont icon-ic_send"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      aria-label={t('chat.input.send')}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'color-mix(in oklch, var(--foreground) 44.4444%, transparent)' : 'var(--primary)',
        fontSize: 22,
        transition: 'all 0.2s',
        marginTop: 1,
        marginRight: 2
      }}
    />
  )
}

export default SendMessageButton
