import { Tooltip, TooltipProps } from '@heroui/react'
import { Info } from 'lucide-react'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

interface InfoTooltipProps extends InheritedTooltipProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
  title?: string // Support legacy title prop for backward compatibility
}

const InfoTooltip = ({
  iconColor = 'var(--color-text-2)',
  iconSize = 14,
  iconStyle,
  title,
  ...rest
}: InfoTooltipProps) => {
  return (
    <Tooltip showArrow={true} content={title || rest.content} {...rest}>
      <Info size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Information" />
    </Tooltip>
  )
}

export default InfoTooltip
