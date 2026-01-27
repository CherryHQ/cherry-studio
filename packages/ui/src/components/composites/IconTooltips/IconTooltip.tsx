import type { LucideIcon } from 'lucide-react'

import { Tooltip } from '../../primitives/tooltip'
import type { IconTooltipProps } from './types'

export interface BaseIconTooltipProps extends IconTooltipProps {
  /** The Lucide icon component to render */
  icon: LucideIcon
  /** Accessible label for screen readers */
  ariaLabel?: string
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
  ariaLabel = 'Icon',
  defaultColor,
  ...tooltipProps
}: BaseIconTooltipProps) => {
  return (
    <Tooltip {...tooltipProps}>
      <Icon
        size={iconProps?.size ?? 14}
        color={iconProps?.color ?? defaultColor}
        role="img"
        aria-label={ariaLabel}
        {...iconProps}
      />
    </Tooltip>
  )
}
