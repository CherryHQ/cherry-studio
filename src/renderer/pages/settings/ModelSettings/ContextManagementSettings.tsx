import { EditableNumber, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
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
import { MIN_TRUNCATE_THRESHOLD } from '@shared/data/types/contextSettings'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { DefaultModelSelector } from './DefaultModelSelector'

const chatModelFilter = (model: Model) => !isNonChatModel(model)

/**
 * Global layer of the `chat.context_settings.*` preferences (the assistant
 * edit dialog's「上下文管理」override seeds from — and wins over — these).
 * Reads take effect per request; no service restart involved.
 */
export const ContextManagementSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [enabled, setEnabled] = usePreference('chat.context_settings.enabled')
  const [maxMessages, setMaxMessages] = usePreference('chat.context_settings.max_messages')
  const [truncateThreshold, setTruncateThreshold] = usePreference('chat.context_settings.truncate_threshold')
  const [compressEnabled, setCompressEnabled] = usePreference('chat.context_settings.compress.enabled')
  const [compressModelId, setCompressModelId] = usePreference('chat.context_settings.compress.model_id')

  const { model: compressModel } = useModelById(compressModelId as UniqueModelId | null)
  const { providers } = useProviders({ enabled: true })

  // `undefined` is the selector's CLEAR signal, not a no-op: swallowing it left
  // the field stuck on whatever model was picked first, with no way back to
  // "follow current model".
  const handleSelectCompressModel = useCallback(
    (selected: Model | undefined) => {
      void setCompressModelId(selected?.id ?? null)
    },
    [setCompressModelId]
  )

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.models.context_management.title')}</SettingTitle>
      <SettingDivider />
      {/* Outside the master switch: this bounds how much history each request
          carries, which is independent of the offload/compression machinery
          the switch below governs. */}
      <SettingRow>
        <div className="min-w-0 flex-1">
          <SettingRowTitle>{t('settings.models.context_management.max_messages')}</SettingRowTitle>
          <SettingDescription className="mt-1.5 leading-5">
            {t('settings.models.context_management.max_messages_description')}
          </SettingDescription>
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
          <SettingRowTitle>{t('settings.models.context_management.enabled')}</SettingRowTitle>
          <SettingDescription className="mt-1.5 leading-5">
            {t('settings.models.context_management.enabled_description')}
          </SettingDescription>
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
              <SettingRowTitle>{t('settings.models.context_management.truncate_threshold')}</SettingRowTitle>
              <SettingDescription className="mt-1.5 leading-5">
                {t('settings.models.context_management.truncate_threshold_description')}
              </SettingDescription>
            </div>
            <div className="w-[220px] shrink-0">
              <EditableNumber
                block
                // Floor, not 1: this value is handed to fs_read as its per-call
                // output cap, and every line it returns carries a 7-char gutter
                // (`padStart(6)` + tab). Below this a single line can exceed the
                // cap, so persisted output becomes permanently unreadable.
                min={MIN_TRUNCATE_THRESHOLD}
                // step=1000 with min=1 made the 50000 default a stepMismatch
                // (49999 % 1000 !== 0), which native validation and assistive
                // tech both report as invalid.
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
              <SettingRowTitle>{t('settings.models.context_management.compress_enabled')}</SettingRowTitle>
              <SettingDescription className="mt-1.5 leading-5">
                {t('settings.models.context_management.compress_enabled_description')}
              </SettingDescription>
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
