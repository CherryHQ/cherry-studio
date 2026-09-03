import { EditableNumber, InfoTooltip, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import {
  MAX_COMPRESS_THRESHOLD_PERCENT,
  MIN_COMPRESS_THRESHOLD_PERCENT,
  MIN_TRUNCATE_THRESHOLD
} from '@shared/data/types/contextSettings'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { clampThresholdPercent } from '@shared/utils/contextSettings'
import { isNonChatModel } from '@shared/utils/model'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const SettingRowTitleWithTooltip = ({ title, description }: { title: string; description: string }) => (
  <SettingRowTitle className="gap-1">
    {title}
    <InfoTooltip
      content={description}
      ariaLabel={`${title}: ${description}`}
      iconProps={{ className: 'cursor-pointer' }}
    />
  </SettingRowTitle>
)

/**
 * Global layer of the `chat.context_settings.*` preferences (the assistant
 * edit dialog's「上下文管理」override seeds from — and wins over — these).
 * Reads take effect per request; no service restart involved.
 */
export const ContextManagementSettings = () => {
  const { t } = useTranslation()
  const chatModelFilter = useCallback<ModelSelectorFilter>((model) => !isNonChatModel(model), [])
  const { theme } = useTheme()
  const [enabled, setEnabled] = usePreference('chat.context_settings.enabled')
  const [maxMessages, setMaxMessages] = usePreference('chat.context_settings.max_messages')
  const [truncateThreshold, setTruncateThreshold] = usePreference('chat.context_settings.truncate_threshold')
  const [compressEnabled, setCompressEnabled] = usePreference('chat.context_settings.compress.enabled')
  const [compressModelId, setCompressModelId] = usePreference('chat.context_settings.compress.model_id')
  const [compressThreshold, setCompressThreshold] = usePreference('chat.context_settings.compress.threshold_percent')

  const { model: compressModel } = useModelById(compressModelId as UniqueModelId | null)
  const { providers } = useProviders({ enabled: true })

  // `undefined` is the selector's CLEAR signal — swallowing it left no way
  // back to "follow current model".
  const handleSelectCompressModel = useCallback(
    (selected: Model | undefined) => {
      void setCompressModelId(selected?.id ?? null)
    },
    [setCompressModelId]
  )

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.models.context_management.title')}</SettingTitle>
      <SettingDescription>{t('settings.models.context_management.scope_description')}</SettingDescription>
      <SettingDivider />
      {/* Outside the master switch: scope is not an overflow policy. */}
      <SettingRow>
        <div className="min-w-0 flex-1">
          <SettingRowTitleWithTooltip
            title={t('settings.models.context_management.max_messages')}
            description={t('settings.models.context_management.max_messages_description')}
          />
        </div>
        <div className="w-[220px] shrink-0">
          <EditableNumber
            block
            min={1}
            step={1}
            precision={0}
            align="start"
            changeOnBlur
            aria-label={t('settings.models.context_management.max_messages')}
            placeholder={t('settings.models.context_management.max_messages_unlimited')}
            className="h-8 rounded-lg border-border bg-transparent px-2.5 shadow-none focus-visible:border-primary"
            value={maxMessages}
            onChange={(value) => void setMaxMessages(value === null ? null : Math.floor(value))}
          />
        </div>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <div className="min-w-0 flex-1">
          <SettingRowTitleWithTooltip
            title={t('settings.models.context_management.enabled')}
            description={t('settings.models.context_management.enabled_description')}
          />
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          // SettingRowTitle renders a plain div, so it contributes no accessible
          // name — without this the control announces as an unnamed "switch".
          aria-label={t('settings.models.context_management.enabled')}
        />
      </SettingRow>
      {enabled && (
        <>
          <SettingDivider />
          <SettingRow>
            <div className="min-w-0 flex-1">
              <SettingRowTitleWithTooltip
                title={t('settings.models.context_management.truncate_threshold')}
                description={t('settings.models.context_management.truncate_threshold_description')}
              />
            </div>
            <div className="w-[220px] shrink-0">
              <EditableNumber
                block
                // Floor: this doubles as fs_read's per-call cap, and below it a
                // single gutter-prefixed line already overflows.
                min={MIN_TRUNCATE_THRESHOLD}
                // step=1000 made the 50000 default a stepMismatch.
                step={1}
                precision={0}
                align="start"
                changeOnBlur
                aria-label={t('settings.models.context_management.truncate_threshold')}
                className="h-8 rounded-lg border-border bg-transparent px-2.5 shadow-none focus-visible:border-primary"
                value={truncateThreshold}
                onChange={(value) => {
                  if (typeof value !== 'number' || !Number.isFinite(value)) return
                  void setTruncateThreshold(Math.max(MIN_TRUNCATE_THRESHOLD, Math.floor(value)))
                }}
              />
            </div>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <div className="min-w-0 flex-1">
              <SettingRowTitleWithTooltip
                title={t('settings.models.context_management.compress_enabled')}
                description={t('settings.models.context_management.compress_enabled_description')}
              />
            </div>
            <Switch
              checked={compressEnabled}
              onCheckedChange={setCompressEnabled}
              aria-label={t('settings.models.context_management.compress_enabled')}
            />
          </SettingRow>
          {compressEnabled && (
            <>
              <SettingDivider />
              <SettingRow>
                <div className="min-w-0 flex-1">
                  <SettingRowTitleWithTooltip
                    title={t('settings.models.context_management.compress_threshold')}
                    description={t('settings.models.context_management.compress_threshold_description')}
                  />
                </div>
                <div className="w-[220px] shrink-0">
                  <EditableNumber
                    block
                    min={MIN_COMPRESS_THRESHOLD_PERCENT}
                    max={MAX_COMPRESS_THRESHOLD_PERCENT}
                    step={5}
                    precision={0}
                    suffix="%"
                    align="start"
                    changeOnBlur
                    aria-label={t('settings.models.context_management.compress_threshold')}
                    className="h-8 rounded-lg border-border bg-transparent px-2.5 shadow-none focus-visible:border-primary"
                    value={compressThreshold}
                    onChange={(value) => void setCompressThreshold(clampThresholdPercent(value))}
                  />
                </div>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.models.context_management.compress_model')}</SettingRowTitle>
                <div className="flex w-[220px] min-w-0 items-center">
                  <DefaultModelSelector
                    model={compressModel}
                    providers={providers}
                    filter={chatModelFilter}
                    onSelect={handleSelectCompressModel}
                    placeholder={t('settings.models.context_management.compress_model_follow')}
                  />
                </div>
              </SettingRow>
            </>
          )}
        </>
      )}
    </SettingGroup>
  )
}
