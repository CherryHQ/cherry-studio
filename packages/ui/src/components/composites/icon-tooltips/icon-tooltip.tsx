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
  ...tooltipProps
}: BaseIconTooltipProps) => {
  const accessibleLabel =
    ariaLabel ?? iconProps?.['aria-label'] ?? (typeof content === 'string' ? content : defaultAriaLabel)

  return (
    <Tooltip content={content} {...tooltipProps}>
      <span
        role="img"
        aria-label={accessibleLabel}
        tabIndex={0}
        className="inline-flex shrink-0 items-center justify-center rounded-sm outline-none focus-visible:bg-accent">
        <Icon
          size={iconProps?.size ?? 14}
          color={iconProps?.color ?? defaultColor}
          {...iconProps}
          aria-hidden="true"
          focusable="false"
          tabIndex={-1}
        />
      </span>
    </Tooltip>
  )
}
