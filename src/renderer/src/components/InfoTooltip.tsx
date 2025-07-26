import { InfoCircleOutlined } from '@ant-design/icons'
import { Tooltip, TooltipProps } from 'antd'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

interface InfoTooltipProps extends InheritedTooltipProps {
  iconColor?: string
  iconStyle?: React.CSSProperties
}

const InfoTooltip = ({ iconColor = 'var(--color-text-3)', iconStyle, ...rest }: InfoTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <InfoCircleOutlined style={{ color: iconColor, ...iconStyle }} role="img" aria-label="Information" />
    </Tooltip>
  )
}

export default InfoTooltip
