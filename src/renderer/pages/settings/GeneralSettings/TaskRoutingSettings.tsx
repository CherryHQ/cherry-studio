import { ChevronDown } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Switch } from '@cherrystudio/ui'
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
import { useTheme } from '@renderer/hooks/useTheme'
import { TASK_CATEGORIES } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'

export const TaskRoutingSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [autoEnabled, setAutoEnabled] = usePreference('chat.routing.auto_enabled')
  const [categoryModels, setCategoryModels] = usePreference('chat.routing.category_models')
  const chatModelFilter = useCallback<ModelSelectorFilter>((model) => !isNonChatModel(model), [])

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
      {autoEnabled &&
        TASK_CATEGORIES.map((category) => {
          const selected = categoryModels[category] ?? []
          const categoryLabel = t(`settings.models.routing.category.${category}`)
          return (
            <div key={category}>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{categoryLabel}</SettingRowTitle>
                <div className="flex w-[220px] min-w-0 shrink-0 items-center">
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
                          {selected.length > 0
                            ? t('settings.models.routing.category_count', { count: selected.length })
                            : t('settings.models.empty')}
                        </span>
                        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                      </Button>
                    }
                  />
                </div>
              </SettingRow>
            </div>
          )
        })}
    </SettingGroup>
  )
}
