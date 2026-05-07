import { ColFlex, InfoTooltip, RowFlex } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { ContextSettingsForm } from '@renderer/components/ContextSettings/ContextSettingsForm'
import { type EffectiveContextSettings } from '@shared/data/types/contextSettings'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Global-scope mount of the shared `ContextSettingsForm`. Bridges the
 * four `chat.context_settings.*` preferences with the form's
 * `EffectiveContextSettings` shape and writes per-field changes back
 * via the `useMultiplePreferences` setter.
 *
 * Sits in `GeneralSettings` for now; Cherry has no dedicated "Chat /
 * Conversation" settings page yet, and grouping with the rest of the
 * generic preferences keeps the surface area predictable until we add
 * one.
 */
export const GlobalContextSettingsPanel = () => {
  const { t } = useTranslation()

  const [prefValues, setPrefs] = useMultiplePreferences({
    enabled: 'chat.context_settings.enabled',
    threshold: 'chat.context_settings.truncate_threshold',
    compressEnabled: 'chat.context_settings.compress.enabled',
    compressModelId: 'chat.context_settings.compress.model_id'
  })
  const [topicNamingModelId] = usePreference('topic.naming.model_id')

  // Effective view assembled from prefs. The form contract for global
  // scope expects a fully-resolved object.
  const value: EffectiveContextSettings = useMemo(
    () => ({
      enabled: prefValues.enabled,
      truncateThreshold: prefValues.threshold,
      compress: {
        enabled: prefValues.compressEnabled,
        modelId: prefValues.compressModelId
      }
    }),
    [prefValues]
  )

  const handleChange = useCallback(
    async (next: EffectiveContextSettings | undefined) => {
      // Global scope never returns undefined per the form contract.
      if (!next) return
      const updates: Parameters<typeof setPrefs>[0] = {}
      if (next.enabled !== value.enabled) updates.enabled = next.enabled
      if (next.truncateThreshold !== value.truncateThreshold) updates.threshold = next.truncateThreshold
      if (next.compress.enabled !== value.compress.enabled) updates.compressEnabled = next.compress.enabled
      if (next.compress.modelId !== value.compress.modelId) updates.compressModelId = next.compress.modelId
      if (Object.keys(updates).length > 0) {
        await setPrefs(updates)
      }
    },
    [setPrefs, value]
  )

  return (
    <ColFlex className="gap-3">
      <RowFlex className="items-center gap-2">
        <span className="font-medium">{t('settings.context_settings.label')}</span>
        <InfoTooltip content={t('settings.context_settings.help')} />
      </RowFlex>
      <ContextSettingsForm
        value={value}
        onChange={(next) => void handleChange(next as EffectiveContextSettings | undefined)}
        scope="global"
        topicNamingModelId={topicNamingModelId}
      />
    </ColFlex>
  )
}
