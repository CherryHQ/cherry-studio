// Original path: src/renderer/components/CopyButton.tsx
import { Check, Copy } from 'lucide-react'
import type { ComponentProps, MouseEventHandler } from 'react'
import { useEffect, useRef, useState } from 'react'

import { Tooltip } from './tooltip'

interface CopyButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  tooltip?: string
  textToCopy?: string
  label?: string
  size?: number
  copiedDuration?: number
  onCopySuccess?: () => void
  onCopyError?: (error: unknown) => void
}

const CopyButton = ({
  tooltip,
  textToCopy,
  label,
  size = 14,
  copiedDuration = 1500,
  className = '',
  onClick,
  onCopySuccess,
  onCopyError,
  type = 'button',
  ...props
}: CopyButtonProps) => {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const handleClick: MouseEventHandler<HTMLButtonElement> = async (event) => {
    onClick?.(event)

    if (event.defaultPrevented || textToCopy === undefined) {
      return
    }

    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      onCopySuccess?.()

      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
      }
      resetTimerRef.current = setTimeout(() => setCopied(false), copiedDuration)
    } catch (error) {
      onCopyError?.(error)
    }
  }

  const button = (
    <button
      type={type}
      className={`flex cursor-pointer flex-row items-center gap-1 text-muted-foreground transition-colors duration-200 hover:text-foreground disabled:cursor-not-allowed ${className}`}
      onClick={handleClick}
      {...props}>
      {copied ? (
        <Check size={size} className="copy-icon shrink-0 text-success transition-colors duration-200" />
      ) : (
        <Copy size={size} className="copy-icon shrink-0 transition-colors duration-200" />
      )}
      {label && <span style={{ fontSize: `${size}px` }}>{label}</span>}
    </button>
  )

  if (tooltip) {
    return <Tooltip content={tooltip}>{button}</Tooltip>
  }

  return button
}

export default CopyButton
export type { CopyButtonProps }
