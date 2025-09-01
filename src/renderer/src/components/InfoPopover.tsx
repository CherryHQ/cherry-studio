import { Popover, PopoverProps } from 'antd'
import { Info } from 'lucide-react'

type InheritedPopoverProps = Omit<PopoverProps, 'children'>

interface InfoPopoverProps extends InheritedPopoverProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
}

const InfoPopover = ({ iconColor = 'var(--color-text-3)', iconSize = 14, iconStyle, ...rest }: InfoPopoverProps) => {
  return (
    <Popover {...rest}>
      <Info size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Information" />
    </Popover>
  )
}

export default InfoPopover
