// Original: src/renderer/src/components/TooltipIcons/InfoTooltip.tsx
import { Info } from 'lucide-react'

import Tooltip from '../../base/Tooltip'

interface InfoTooltipProps {
  title: React.ReactNode
  placement?:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-start'
    | 'top-end'
    | 'bottom-start'
    | 'bottom-end'
    | 'left-start'
    | 'left-end'
    | 'right-start'
    | 'right-end'
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
  [key: string]: any
}

const InfoTooltip = ({
  title,
  placement = 'top',
  iconColor = 'var(--color-text-2)',
  iconSize = 14,
  iconStyle,
  ...rest
}: InfoTooltipProps) => {
  return (
    <Tooltip placement={placement} content={title} {...rest}>
      <Info size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Information" />
    </Tooltip>
  )
}

export default InfoTooltip
