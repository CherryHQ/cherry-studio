import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  InfoTooltip,
  InputGroup,
  InputGroupAddon,
  InputGroupInputNumber,
  InputGroupText,
  InputNumber,
  Switch,
  HelpTooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CompressionWindowField } from '@renderer/components/CompressionWindowField'
import { DefaultModelSelector } from '@renderer/components/DefaultModelSelector'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { settingsControlClasses } from '@renderer/pages/settings/settingsStyles'
import {
  MAX_COMPRESS_THRESHOLD_PERCENT,
  MIN_COMPRESS_THRESHOLD_PERCENT,
  MIN_TRUNCATE_THRESHOLD
} from '@shared/data/types/contextSettings'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { isValidCompressionWindow, clampThresholdPercent } from '@shared/utils/contextSettings'
import { isNonChatModel } from '@shared/utils/model'

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
  const [compressWindow, setCompressWindow] = usePreference('chat.context_settings.compress_window')
  const [invalidRecent, setInvalidRecent] = useState(false)
  const [recentDraft, setRecentDraft] = useState<number | null | undefined>(undefined)
  const recentLabel =
    compressWindow == null || !isValidCompressionWindow(maxMessages, compressWindow)
      ? t('settings.models.context_management.max_messages')
      : t('settings.models.context_management.window_recent')
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
      <SettingTitle className="justify-start gap-1.5">
        {t('settings.models.context_management.title')}{' '}
        <HelpTooltip content={t('settings.models.context_management.scope_description')} />
      </SettingTitle>
      <SettingDivider />
      {/* Outside the master switch: scope is not an overflow policy. */}
      <SettingRow id="setting-general-context-max-messages" className="scroll-mt-6">
        <div className="min-w-0 flex-1">
          <SettingRowTitleWithTooltip
            title={recentLabel}
            description={
              compressWindow == null || !isValidCompressionWindow(maxMessages, compressWindow)
                ? t('settings.models.context_management.max_messages_description')
                : t('settings.models.context_management.window_description')
            }
          />
        </div>
        <div className="w-28 shrink-0 sm:w-60">
          <InputNumber
            aria-label={recentLabel}
            aria-invalid={invalidRecent || undefined}
            placeholder={t('settings.models.context_management.max_messages_unlimited')}
            className="h-8 rounded-lg px-2.5"
            value={recentDraft === undefined ? maxMessages : recentDraft}
            onBlur={(value) => {
              const next = value
              if (
                (next !== null && (!Number.isInteger(next) || next < 1)) ||
                !isValidCompressionWindow(next, compressWindow)
              ) {
                setInvalidRecent(true)
                setRecentDraft(next)
                return
              }
              setInvalidRecent(false)
              setRecentDraft(undefined)
              return setMaxMessages(next)
            }}
          />
        </div>
      </SettingRow>
      {invalidRecent && (
        <p role="alert" className="text-xs text-destructive">
          {t('settings.models.context_management.window_invalid')}
        </p>
      )}
      <SettingDivider />
      <div id="setting-general-context-compress-window" className="scroll-mt-6">
        <CompressionWindowField
          value={compressWindow}
          recent={maxMessages}
          onChange={(value) => {
            setInvalidRecent(false)
            setRecentDraft(undefined)
            return setCompressWindow(value ?? null)
          }}
        />
      </div>
      <SettingDivider />
      <SettingRow id="setting-general-context-enabled" className="scroll-mt-6">
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
            <div className={settingsControlClasses.field}>
              <InputNumber
                // Floor: this doubles as fs_read's per-call cap, and below it a
                // single gutter-prefixed line already overflows.
                min={MIN_TRUNCATE_THRESHOLD}
                // step=1000 made the 50000 default a stepMismatch.
                step={1}
                aria-label={t('settings.models.context_management.truncate_threshold')}
                className="h-8 rounded-lg px-2.5"
                value={truncateThreshold}
                onBlur={(value) => {
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
                <div className={settingsControlClasses.field}>
                  <InputGroup className="h-8 rounded-lg">
                    <InputGroupInputNumber
                      min={MIN_COMPRESS_THRESHOLD_PERCENT}
                      max={MAX_COMPRESS_THRESHOLD_PERCENT}
                      step={5}
                      aria-label={t('settings.models.context_management.compress_threshold')}
                      className="px-2.5"
                      value={compressThreshold}
                      onBlur={(value) => void setCompressThreshold(clampThresholdPercent(value))}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>%</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.models.context_management.compress_model')}</SettingRowTitle>
                <div className={`flex min-w-0 items-center ${settingsControlClasses.model}`}>
                  <DefaultModelSelector
                    model={compressModel}
                    providers={providers}
                    filter={chatModelFilter}
                    onSelect={handleSelectCompressModel}
                    placeholder={t('settings.models.context_management.compress_model_follow')}
                    noneOptionLabel={t('settings.models.context_management.compress_model_follow')}
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
