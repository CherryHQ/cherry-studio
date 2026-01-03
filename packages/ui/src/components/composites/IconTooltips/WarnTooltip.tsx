// Original path: src/renderer/src/components/TooltipIcons/WarnTooltip.tsx
import { AlertTriangle } from 'lucide-react'

import { Tooltip } from '../../primitives/tooltip'
import type { IconTooltipProps } from './types'

export const WarnTooltip = ({ iconProps, ...rest }: IconTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <AlertTriangle
        size={iconProps?.size ?? 14}
        color={iconProps?.color ?? 'var(--color-status-warning)'}
        role="img"
        aria-label="Warning"
        {...iconProps}
      />
    </Tooltip>
  )
}
