import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { McpServerCatalogGrid } from '@renderer/components/resourceCatalog/dialogs/components/McpServerCatalogGrid'
import { SettingDescription, SettingDivider, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { preferenceService } from '@renderer/data/PreferenceService'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'

const DEFAULT_MCP_KEY = 'assistant.default_mcp_server_ids'

export function DefaultMcpServersSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [ids] = usePreference(DEFAULT_MCP_KEY, { optimistic: false })
  const [ready, setReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const savingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoadFailed(false)
    void preferenceService
      .get(DEFAULT_MCP_KEY)
      .then(() => {
        if (cancelled) return
        const loaded = preferenceService.getCachedValue(DEFAULT_MCP_KEY) !== undefined
        setReady(loaded)
        setLoadFailed(!loaded)
      })
      .catch(() => {
        if (!cancelled) {
          setReady(false)
          setLoadFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const toggle = async (id: string, enabled: boolean) => {
    if (!ready || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveFailed(false)
    try {
      await ipcApi.request('assistant.toggle_default_mcp', { serverId: id, enabled })
    } catch {
      setSaveFailed(true)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('assistant.mcp_defaults.title')}</SettingTitle>
      <SettingDivider />
      <SettingDescription>{t('assistant.mcp_defaults.description')}</SettingDescription>
      <div className="mt-3">
        {loadFailed ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-error">{t('assistant.mcp_defaults.load_failed')}</p>
            <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              {t('common.retry')}
            </Button>
          </div>
        ) : !ready ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : (
          <McpServerCatalogGrid
            enabledIds={new Set(ids)}
            disabled={saving}
            emptyLabel={t('library.config.tools.empty_title')}
            portalContainer={null}
            onToggle={(id, enabled) => void toggle(id, enabled)}
          />
        )}
        {saveFailed ? (
          <p role="alert" className="mt-2 text-sm text-error">
            {t('common.save_failed')}
          </p>
        ) : null}
      </div>
    </SettingGroup>
  )
}
