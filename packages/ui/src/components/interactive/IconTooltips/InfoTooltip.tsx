// Original: src/renderer/src/components/TooltipIcons/InfoTooltip.tsx
import { Info } from 'lucide-react'

import { Tooltip } from '../../base/Tooltip'
import type { IconTooltipProps } from './types'

export const InfoTooltip = ({ iconProps, ...rest }: IconTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <Info
        size={iconProps?.size ?? 14}
        color={iconProps?.color ?? 'var(--color-text-2)'}
        role="img"
        aria-label="Information"
        {...iconProps}
      />
    </Tooltip>
  )
}
