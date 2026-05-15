import IndicatorLight from '@renderer/components/IndicatorLight'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { getProviderLabel } from '@renderer/i18n/label'
import NavigationService from '@renderer/services/NavigationService'
import { ArrowUpRight } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  modelId: string
  providerId: string
  showLabel?: boolean
}

export const FreeTrialModelTag: FC<Props> = ({ modelId, providerId, showLabel = true }) => {
  const { t } = useTranslation()

  if (providerId !== 'cherryai') {
    return null
  }

  const rawId = modelId.includes('::') ? modelId.slice(modelId.indexOf('::') + 2) : modelId
  const cherryInModels = ['Qwen/Qwen3-8B', 'Qwen/Qwen3-Next-80B-A3B-Instruct']
  const linkedProviderId = cherryInModels.includes(rawId) ? 'cherryin' : ''
  if (!linkedProviderId) return null

  const onSelectProvider = () => {
    void NavigationService.navigate?.({ to: '/settings/provider', search: { id: linkedProviderId } })
  }

  const onNavigateProvider = (e: MouseEvent) => {
    e.stopPropagation()
    void NavigationService.navigate?.({ to: '/settings/provider', search: { id: linkedProviderId } })
  }

  if (!showLabel) {
    return (
      <div className="flex flex-row items-center gap-1">
        <CustomTag
          color="var(--color-primary)"
          size={11}
          onClick={onNavigateProvider}
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {getProviderLabel(linkedProviderId)}
          <ArrowUpRight size={12} />
        </CustomTag>
      </div>
    )
  }

  return (
    <div className="flex flex-row items-center gap-1">
      <IndicatorLight size={6} color="var(--color-primary)" animation={false} shadow={false} />
      <span className="text-muted-foreground text-xs">{t('common.powered_by')}</span>
      <button type="button" className="text-primary text-xs hover:underline" onClick={onSelectProvider}>
        {getProviderLabel(linkedProviderId)}
      </button>
    </div>
  )
}
