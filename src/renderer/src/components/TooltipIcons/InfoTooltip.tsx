import type { TooltipProps } from 'antd'
import { Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

interface InfoTooltipProps extends InheritedTooltipProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
}

const InfoTooltip = ({ iconColor = 'var(--color-text-2)', iconSize = 14, iconStyle, ...rest }: InfoTooltipProps) => {
  const { t } = useTranslation()
  return (
    <Tooltip {...rest}>
      <Info size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label={t('common.information', 'Information')} />
    </Tooltip>
  )
}

export default InfoTooltip
