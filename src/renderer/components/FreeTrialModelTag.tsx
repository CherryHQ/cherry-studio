import { getProviderLabel } from '@renderer/i18n/label'
import NavigationService from '@renderer/services/NavigationService'
import type { Model } from '@renderer/types'
import { ArrowUpRight } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import IndicatorLight from './IndicatorLight'
import CustomTag from './Tags/CustomTag'

interface Props {
  model: Model
  showLabel?: boolean
}

export const FreeTrialModelTag: FC<Props> = ({ model, showLabel = true }) => {
  const { t } = useTranslation()

  if (model.provider !== 'cherryai') {
    return null
  }

  let providerId

  if (model.id === 'Qwen/Qwen3-8B') {
    providerId = 'cherryin'
  }

  if (model.id === 'Qwen/Qwen3-Next-80B-A3B-Instruct') {
    providerId = 'cherryin'
  }

  const onSelectProvider = () => {
    void NavigationService.navigate!({ to: `/settings/provider`, search: { id: providerId } })
  }

  const onNavigateProvider = (e: MouseEvent) => {
    e.stopPropagation()
    void NavigationService.navigate?.({ to: '/settings/provider', search: { id: providerId } })
  }

  if (!showLabel) {
    return (
      <div className="flex flex-row items-center gap-1">
        <CustomTag
          color="var(--color-primary)"
          size={11}
          onClick={onNavigateProvider}
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {getProviderLabel(providerId)}
          <ArrowUpRight size={12} />
        </CustomTag>
      </div>
    )
  }

  return (
    <div className="flex flex-row items-center gap-1">
      <IndicatorLight size={6} color="var(--color-primary)" animation={false} shadow={false} />
      <span className="text-[12px] text-foreground-secondary">{t('common.powered_by')}</span>
      <a className="text-[12px] text-primary" onClick={onSelectProvider}>
        {getProviderLabel(providerId)}
      </a>
    </div>
  )
}
