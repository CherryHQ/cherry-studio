/**
 * HindsightSettings — configuration panel for the Hindsight memory provider.
 * Displayed only when provider = 'hindsight'.
 */

import { Button, Input, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { memoryService } from '@renderer/services/MemoryService'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDescription, SettingGroup, SettingRow, SettingRowTitle, SettingSubtitle } from '../index'

export function HindsightSettings() {
  const { t } = useTranslation()
  const [baseUrl, setBaseUrl] = usePreference('feature.memory.hindsight.base_url')
  const [apiKey, setApiKey] = usePreference('feature.memory.hindsight.api_key')
  const [bankPrefix, setBankPrefix] = usePreference('feature.memory.hindsight.default_bank_prefix')
  const [reflectEnabled, setReflectEnabled] = usePreference('feature.memory.hindsight.reflect_enabled')
  const [timeoutMs, setTimeoutMs] = usePreference('feature.memory.hindsight.timeout_ms')

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')

  const handleTestConnection = async () => {
    setTestStatus('testing')
    try {
      const ok = await memoryService.healthCheck()
      setTestStatus(ok ? 'ok' : 'error')
    } catch {
      setTestStatus('error')
    }
  }

  return (
    <SettingGroup>
      <SettingSubtitle>{t('settings.memory.hindsight.title', 'Hindsight Server')}</SettingSubtitle>
      <SettingDescription>
        {t(
          'settings.memory.hindsight.description',
          'Connect to a self-hosted Hindsight server or Hindsight Cloud. Run locally with Docker: docker run -p 8888:8888 -p 9999:9999 -e HINDSIGHT_API_LLM_API_KEY=<your-key> ghcr.io/vectorize-io/hindsight:latest'
        )}
      </SettingDescription>

      <div className="mt-4 space-y-3">
        <SettingRow>
          <SettingRowTitle>{t('settings.memory.hindsight.base_url', 'Server URL')}</SettingRowTitle>
          <div className="flex flex-col items-end gap-1">
            <Input
              className="w-72"
              placeholder="http://localhost:8888"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="w-72 text-muted-foreground text-xs leading-snug">
              {t(
                'settings.memory.hindsight.base_url_hint',
                'Base URL only — do not include /mcp/... paths or a trailing slash. Examples: http://localhost:8888 (local Docker) or https://api.hindsight.example.com (Cloud).'
              )}
            </p>
          </div>
        </SettingRow>

        <SettingRow>
          <SettingRowTitle>{t('settings.memory.hindsight.api_key', 'API Key')}</SettingRowTitle>
          <Input
            className="w-72"
            type="password"
            placeholder={t('settings.memory.hindsight.api_key_placeholder', 'Leave empty for local server')}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </SettingRow>

        <SettingRow>
          <SettingRowTitle>{t('settings.memory.hindsight.bank_prefix', 'Bank Prefix')}</SettingRowTitle>
          <Input
            className="w-40"
            placeholder="cherry"
            value={bankPrefix}
            onChange={(e) => setBankPrefix(e.target.value)}
          />
        </SettingRow>

        <SettingRow>
          <SettingRowTitle>{t('settings.memory.hindsight.timeout', 'Request Timeout (ms)')}</SettingRowTitle>
          <Input
            className="w-24"
            type="number"
            min={1000}
            max={60000}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
          />
        </SettingRow>

        <SettingRow>
          <SettingRowTitle>
            {t('settings.memory.hindsight.reflect_enabled', 'Enable Reflect in Memory Browser')}
          </SettingRowTitle>
          <Switch checked={reflectEnabled} onCheckedChange={(v) => setReflectEnabled(v)} />
        </SettingRow>

        <div className="pt-2">
          <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={testStatus === 'testing'}>
            {testStatus === 'testing'
              ? t('settings.memory.hindsight.testing', 'Testing…')
              : t('settings.memory.hindsight.test_connection', 'Test Connection')}
          </Button>
          {testStatus === 'ok' && (
            <span className="ml-3 text-green-600 text-sm">{t('settings.memory.hindsight.test_ok', 'Connected')}</span>
          )}
          {testStatus === 'error' && (
            <span className="ml-3 text-red-500 text-sm">
              {t('settings.memory.hindsight.test_error', 'Connection failed. Check URL and API key.')}
            </span>
          )}
        </div>
      </div>
    </SettingGroup>
  )
}
