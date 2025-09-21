// Original: src/renderer/src/components/TooltipIcons/InfoTooltip.tsx
import type { TooltipProps } from 'antd'
// eslint-disable-next-line no-restricted-imports
import { Tooltip } from 'antd'
import { Info } from 'lucide-react'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

interface InfoTooltipProps extends InheritedTooltipProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
}

const InfoTooltip = ({ iconColor = 'var(--color-text-2)', iconSize = 14, iconStyle, ...rest }: InfoTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <Info size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Information" />
    </Tooltip>
  )
}

export default InfoTooltip
