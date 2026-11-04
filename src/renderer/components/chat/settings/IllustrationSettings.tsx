import { useTranslation } from 'react-i18next'

import { InputNumber, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import {
  MAX_ILLUSTRATION_COUNT,
  IllustrationModeSchema,
  normalizeIllustrationCount
} from '@shared/data/types/illustration'
import { isGenerateImageModel } from '@shared/utils/model'

import { SettingDivider, SettingRow, SettingRowTitleSmall, SettingSwitch } from './settingsPanelPrimitives'

export function IllustrationSettings() {
  const { t } = useTranslation()
  const [mode, setMode] = usePreference('chat.illustration.mode')
  const [maxCount, setMaxCount] = usePreference('chat.illustration.max_count')
  const [forceCount, setForceCount] = usePreference('chat.illustration.force_count')
  const [targetCount, setTargetCount] = usePreference('chat.illustration.target_count')
  const { paintingModel, setPaintingModel } = useDefaultModel()
  const { providers } = useProviders({ enabled: true })
  const normalizedMaxCount = normalizeIllustrationCount(maxCount)
  const normalizedTargetCount = normalizeIllustrationCount(targetCount, normalizedMaxCount)
  return (
    <>
      <SettingRow id="setting-appearance-illustrations" className="scroll-mt-6">
        <SettingRowTitleSmall hint={t('settings.messages.illustration.hint')}>
          {t('settings.messages.illustration.label')}
        </SettingRowTitleSmall>
        <Select
          value={mode}
          onValueChange={(value) => {
            const parsed = IllustrationModeSchema.safeParse(value)
            if (parsed.success) void setMode(parsed.data)
          }}>
          <SelectTrigger aria-label={t('settings.messages.illustration.label')} size="sm" className="w-[220px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('settings.messages.illustration.auto')}</SelectItem>
            <SelectItem value="on">{t('settings.messages.illustration.on')}</SelectItem>
            <SelectItem value="off">{t('settings.messages.illustration.off')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      {mode !== 'off' && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall hint={t('settings.messages.illustration.max_count_hint')}>
              {t('settings.messages.illustration.max_count')}
            </SettingRowTitleSmall>
            <InputNumber
              size="small"
              className="w-20 text-sm"
              aria-label={t('settings.messages.illustration.max_count')}
              min={1}
              max={MAX_ILLUSTRATION_COUNT}
              step={1}
              value={normalizedMaxCount}
              onBlur={async (value) => {
                const nextMaxCount = normalizeIllustrationCount(value)
                await setMaxCount(nextMaxCount)
                if (normalizedTargetCount > nextMaxCount) await setTargetCount(nextMaxCount)
              }}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingSwitch
              checked={forceCount}
              onCheckedChange={(checked) => void setForceCount(checked)}
              label={t('settings.messages.illustration.force_count')}
              hint={t('settings.messages.illustration.force_count_hint')}
            />
          </SettingRow>
          {forceCount && (
            <>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitleSmall>{t('settings.messages.illustration.target_count')}</SettingRowTitleSmall>
                <InputNumber
                  size="small"
                  className="w-20 text-sm"
                  aria-label={t('settings.messages.illustration.target_count')}
                  min={1}
                  max={normalizedMaxCount}
                  step={1}
                  value={normalizedTargetCount}
                  onBlur={(value) => setTargetCount(normalizeIllustrationCount(value, normalizedMaxCount))}
                />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingRowTitleSmall>{t('settings.models.painting_model')}</SettingRowTitleSmall>
            <div className="flex w-[220px] min-w-0">
              <DefaultModelSelector
                model={paintingModel}
                providers={providers}
                filter={isGenerateImageModel}
                placeholder={t('settings.models.empty')}
                aria-label={t('settings.models.painting_model')}
                onSelect={(model) => {
                  if (model) void setPaintingModel(model)
                }}
              />
            </div>
          </SettingRow>
          {!paintingModel && (
            <p className="mt-2 text-sm text-muted-foreground">{t('chat.input.generate_image_no_model')}</p>
          )}
        </>
      )}
      <SettingDivider />
    </>
  )
}
