// Original path: src/renderer/src/components/TooltipIcons/HelpTooltip.tsx
import { HelpCircle } from 'lucide-react'

import { Tooltip } from '../../base/Tooltip'
import type { IconTooltipProps } from './types'

export const HelpTooltip = ({ iconProps, ...rest }: IconTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <HelpCircle
        size={iconProps?.size ?? 14}
        color={iconProps?.color ?? 'var(--color-text-2)'}
        role="img"
        aria-label="Help"
        {...iconProps}
      />
    </Tooltip>
  )
}
