import { Tooltip } from '@cherrystudio/ui'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import { Check, Copy } from 'lucide-react'
import type { ComponentProps, CSSProperties, FC, MouseEventHandler } from 'react'
import { useTranslation } from 'react-i18next'

interface CopyButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  tooltip?: string
  textToCopy: string
  label?: string
  color?: string
  hoverColor?: string
  size?: number
  successFeedback?: 'toast' | 'icon'
}

type CopyButtonStyle = CSSProperties & {
  '--copy-button-color': string
  '--copy-button-hover-color': string
}

const CopyButton: FC<CopyButtonProps> = ({
  tooltip,
  textToCopy,
  label,
  color = 'color-mix(in oklch, var(--foreground) 66.6667%, transparent)',
  hoverColor = 'var(--primary)',
  size = 14,
  successFeedback = 'toast',
  className,
  style,
  onClick,
  type = 'button',
  ...props
}) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useTemporaryValue(false)

  const handleCopy: MouseEventHandler<HTMLButtonElement> = (event) => {
    onClick?.(event)
    if (event.defaultPrevented) return

    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        if (successFeedback === 'icon') {
          setCopied(true)
        } else {
          toast.success(t('message.copy.success'))
        }
      })
      .catch(() => {
        toast.error(t('message.copy.failed'))
      })
  }

  const ariaLabel = props['aria-label'] || tooltip || t('common.copy')
  const buttonStyle: CopyButtonStyle = {
    ...style,
    '--copy-button-color': color,
    '--copy-button-hover-color': hoverColor
  }

  const button = (
    <button
      type={type}
      className={cn(
        'group flex cursor-pointer flex-row items-center gap-1 text-[var(--copy-button-color)] transition-colors hover:text-[var(--copy-button-hover-color)] disabled:cursor-not-allowed',
        className
      )}
      style={buttonStyle}
      onClick={handleCopy}
      aria-label={ariaLabel}
      {...props}>
      {copied ? (
        <Check size={size} className="copy-icon shrink-0 text-success transition-colors" />
      ) : (
        <Copy size={size} className="copy-icon shrink-0 transition-colors" />
      )}
      {label && <span style={{ fontSize: size }}>{label}</span>}
    </button>
  )

  if (tooltip) {
    return <Tooltip content={tooltip}>{button}</Tooltip>
  }

  return button
}

export default CopyButton
