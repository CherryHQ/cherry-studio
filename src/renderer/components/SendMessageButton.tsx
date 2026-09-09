import { Tooltip } from '@cherrystudio/ui'
import type { FC, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  disabled: boolean
  onDisabledClick?: () => void
  sendMessage: () => void
  /** Resolved send shortcut label (e.g. "Enter", "⌘Enter") shown in the tooltip. */
  shortcutLabel?: string
}

const SendMessageButton: FC<Props> = ({ disabled, onDisabledClick, sendMessage, shortcutLabel }) => {
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

  const button = (
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
        color: disabled ? 'var(--foreground-disabled)' : 'var(--primary)',
        fontSize: 22,
        transition: 'all 0.2s',
        marginTop: 1,
        marginRight: 2
      }}
    />
  )

  if (shortcutLabel) {
    return <Tooltip content={`${t('chat.input.send')} (${shortcutLabel})`}>{button}</Tooltip>
  }

  return button
}

export default SendMessageButton
