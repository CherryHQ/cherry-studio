import { Tooltip, TooltipProps } from '@heroui/react'
import { Info } from 'lucide-react'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

interface InfoTooltipProps extends InheritedTooltipProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
  onClick?: () => void
}

const InfoTooltip = ({
  iconColor = 'var(--color-text-2)',
  iconSize = 14,
  iconStyle,
  onClick,
  ...rest
}: InfoTooltipProps) => {
  return (
    <Tooltip classNames={{ content: 'max-w-[240px]' }} showArrow={true} content={rest.content} {...rest}>
      <Info
        size={iconSize}
        color={iconColor}
        style={{ ...iconStyle }}
        role="img"
        aria-label="Information"
        onClick={onClick}
      />
    </Tooltip>
  )
}

export default InfoTooltip
