import type { TooltipProps } from 'antd'
import { Tooltip } from 'antd'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  return (
    <Tooltip {...rest}>
      <AlertTriangle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label={t('common.warning', 'Warning')} />
    </Tooltip>
  )
}

export default WarnTooltip
