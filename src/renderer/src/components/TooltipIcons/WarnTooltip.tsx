import { Tooltip, TooltipProps } from 'antd'
import { AlertTriangle } from 'lucide-react'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

interface WarnTooltipProps extends InheritedTooltipProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
}

const WarnTooltip = ({
  iconColor = 'var(--color-status-warning)',
  iconSize = 14,
  iconStyle,
  ...rest
}: WarnTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <AlertTriangle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Information" />
    </Tooltip>
  )
}

export default WarnTooltip
