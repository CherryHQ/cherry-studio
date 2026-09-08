import { Tooltip } from '@cherrystudio/ui/components/primitives/tooltip'
import type { LucideIcon } from 'lucide-react'

import type { IconTooltipProps } from './types'

export interface BaseIconTooltipProps extends IconTooltipProps {
  /** The Lucide icon component to render */
  icon: LucideIcon
  /** Fallback accessible label when content is not plain text */
  defaultAriaLabel?: string
  /** Default icon color */
  defaultColor?: string
}

/**
 * A reusable tooltip component that wraps a Lucide icon.
 * This is the base component for InfoTooltip, WarnTooltip, and HelpTooltip.
 */
export const IconTooltip = ({
  icon: Icon,
  iconProps,
  ariaLabel,
  defaultAriaLabel = 'Icon',
  defaultColor,
  content,
  onClick,
  ...tooltipProps
}: BaseIconTooltipProps) => {
  const accessibleLabel =
    ariaLabel ?? iconProps?.['aria-label'] ?? (typeof content === 'string' ? content : defaultAriaLabel)
  const icon = (
    <Icon
      size={iconProps?.size ?? 14}
      color={iconProps?.color ?? defaultColor}
      {...iconProps}
      aria-hidden="true"
      focusable="false"
      tabIndex={-1}
    />
  )
  const triggerClassName =
    'inline-flex shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 outline-none focus-visible:bg-accent'

  return (
    <Tooltip content={content} {...tooltipProps} asChild>
      {onClick ? (
        <button type="button" aria-label={accessibleLabel} className={triggerClassName} onClick={onClick}>
          {icon}
        </button>
      ) : (
        <span role="img" aria-label={accessibleLabel} tabIndex={0} className={triggerClassName}>
          {icon}
        </span>
      )}
    </Tooltip>
  )
}
