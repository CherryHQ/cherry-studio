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

  const handleSelectCompressModel = useCallback(
    (selected: Model | undefined) => {
      if (!selected) return
      void setCompressModelId(selected.id)
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
        <Switch checked={enabled} onCheckedChange={setEnabled} />
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
                min={1}
                step={1000}
                precision={0}
                align="start"
                changeOnBlur
                aria-label={t('settings.models.context_management.truncate_threshold')}
                className="h-8 rounded-lg border-border bg-transparent px-2.5 shadow-none focus-visible:border-primary"
                value={truncateThreshold}
                onChange={(value) => {
                  if (typeof value === 'number' && value > 0) void setTruncateThreshold(Math.floor(value))
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
            <Switch checked={compressEnabled} onCheckedChange={setCompressEnabled} />
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
