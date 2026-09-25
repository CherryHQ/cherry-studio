import { ChevronDown, Pin, PinOff, RotateCcw } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Switch } from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { ModelSelector, type ModelSelectorFilter } from '@renderer/components/ModelSelector'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useModels } from '@renderer/hooks/useModel'
import { useTheme } from '@renderer/hooks/useTheme'
import { TASK_CATEGORIES } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId } from '@shared/data/types/model'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { EMPTY_DERIVED_ROUTING_TABLE } from '@shared/data/types/routing'
import { isNonChatModel } from '@shared/utils/model'

export const TaskRoutingSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [autoEnabled, setAutoEnabled] = usePreference('chat.routing.auto_enabled')
  const [categoryModels, setCategoryModels] = usePreference('chat.routing.category_models')
  const [pinnedModelId, setPinnedModelId] = usePreference('chat.routing.pinned_model')
  const [escalationEnabled, setEscalationEnabled] = usePreference('chat.routing.escalation_enabled')
  const chatModelFilter = useCallback<ModelSelectorFilter>((model) => !isNonChatModel(model), [])
  const derivedTable = useSharedCacheValue('routing.derived_table') ?? EMPTY_DERIVED_ROUTING_TABLE
  const { models } = useModels()

  const getModelName = (id: UniqueModelId) => models.find((m) => m.id === id)?.name ?? id
  const pinnedModelObj = isUniqueModelId(pinnedModelId) ? models.find((m) => m.id === pinnedModelId) : undefined

  const label = t('settings.models.routing.label')

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{label}</SettingTitle>
      <SettingDivider />
      <SettingRow className="items-start gap-6">
        <div className="min-w-0 flex-1">
          <SettingRowTitle>{label}</SettingRowTitle>
          <SettingDescription className="mt-1.5 leading-5">
            {t('settings.models.routing.description')}
          </SettingDescription>
        </div>
        <Switch checked={autoEnabled} onCheckedChange={(checked) => void setAutoEnabled(checked)} aria-label={label} />
      </SettingRow>
      <SettingDivider />
      <SettingRow className="items-start gap-6">
        <div className="min-w-0 flex-1">
          <SettingRowTitle>{t('settings.models.routing.escalation_enabled')}</SettingRowTitle>
          <SettingDescription className="mt-1.5 leading-5">
            {t('settings.models.routing.escalation_description')}
          </SettingDescription>
        </div>
        <Switch
          checked={escalationEnabled}
          onCheckedChange={(checked) => void setEscalationEnabled(checked)}
          aria-label={t('settings.models.routing.escalation_enabled')}
        />
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.models.routing.pinned_model')}</SettingRowTitle>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <div className="w-[180px] min-w-0">
            <ModelSelector
              multiple={false}
              value={pinnedModelObj}
              onSelect={(model: Model | undefined) => void setPinnedModelId(model?.id ?? '')}
              filter={chatModelFilter}
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  className="h-7.5 min-w-0 flex-1 justify-between px-2.5 text-left font-normal">
                  <span className="min-w-0 flex-1 truncate">
                    {pinnedModelObj ? pinnedModelObj.name : t('settings.models.empty')}
                  </span>
                  <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                </Button>
              }
            />
          </div>
          {pinnedModelObj && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              title={t('settings.models.routing.unpin_model')}
              onClick={() => void setPinnedModelId('')}>
              <PinOff size={13} />
            </Button>
          )}
          {!pinnedModelObj && <Pin size={13} className="shrink-0 text-muted-foreground opacity-40" aria-hidden />}
        </div>
      </SettingRow>
      {autoEnabled &&
        TASK_CATEGORIES.map((category) => {
          const selected = categoryModels[category] ?? []
          const isManual = selected.length > 0
          const categoryLabel = t(`settings.models.routing.category.${category}`)
          const topCandidate = derivedTable[category]?.[0]

          return (
            <div key={category}>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{categoryLabel}</SettingRowTitle>
                <div className="flex min-w-0 shrink-0 items-center gap-2">
                  {isManual ? (
                    <>
                      <div className="w-[180px] min-w-0">
                        <ModelSelector
                          multiple={true}
                          selectionType="id"
                          value={selected}
                          onSelect={(modelIds: UniqueModelId[]) =>
                            void setCategoryModels({ ...categoryModels, [category]: modelIds })
                          }
                          filter={chatModelFilter}
                          trigger={
                            <Button
                              type="button"
                              variant="outline"
                              className="h-7.5 min-w-0 flex-1 justify-between px-2.5 text-left font-normal">
                              <span className="min-w-0 flex-1 truncate">
                                {t('settings.models.routing.category_count', { count: selected.length })}
                              </span>
                              <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                            </Button>
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title={t('settings.models.routing.reset_to_auto')}
                        onClick={() => void setCategoryModels({ ...categoryModels, [category]: [] })}>
                        <RotateCcw size={13} />
                      </Button>
                    </>
                  ) : (
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="h-5 text-xs">
                          {t('settings.models.routing.mode_auto')}
                        </Badge>
                        <span className="max-w-[160px] truncate text-sm">
                          {topCandidate ? getModelName(topCandidate.id) : t('settings.models.routing.no_candidate')}
                        </span>
                      </div>
                      {topCandidate && (
                        <span className="text-muted-foreground text-xs">
                          {t('settings.models.routing.why', {
                            q: topCandidate.quality,
                            a: topCandidate.affinity,
                            h: topCandidate.healthDelta,
                            c: topCandidate.quotaDelta
                          })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </SettingRow>
            </div>
          )
        })}
    </SettingGroup>
  )
}
