import { HStack, Tooltip } from '@cherrystudio/ui'
import { Copy } from 'lucide-react'
import type { CSSProperties, FC, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface CopyButtonProps {
  tooltip?: string
  textToCopy: string
  label?: string
  color?: string
  hoverColor?: string
  size?: number
}

type CopyButtonStyle = CSSProperties & {
  '--copy-button-color': string
  '--copy-button-hover-color': string
}

const CopyButton: FC<CopyButtonProps> = ({
  tooltip,
  textToCopy,
  label,
  color = 'var(--color-text-2)',
  hoverColor = 'var(--color-primary)',
  size = 14
}) => {
  const { t } = useTranslation()

  const handleCopy = () => {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        window.toast?.success(t('message.copy.success'))
      })
      .catch(() => {
        window.toast?.error(t('message.copy.failed'))
      })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleCopy()
    }
  }

  const ariaLabel = tooltip || t('common.copy')
  const buttonStyle: CopyButtonStyle = {
    '--copy-button-color': color,
    '--copy-button-hover-color': hoverColor
  }

  const button = (
    <HStack
      style={buttonStyle}
      onClick={handleCopy}
      onKeyDown={handleKeyDown}
      role="button"
      aria-label={ariaLabel}
      tabIndex={0}
      gap={1}
      className="group cursor-pointer text-[var(--copy-button-color)] transition-colors hover:text-[var(--copy-button-hover-color)]">
      <Copy size={size} className="copy-icon shrink-0 transition-colors" />
      {label && <span style={{ fontSize: size }}>{label}</span>}
    </HStack>
  )

  if (tooltip) {
    return <Tooltip content={tooltip}>{button}</Tooltip>
  }

  return button
}

export default CopyButton
