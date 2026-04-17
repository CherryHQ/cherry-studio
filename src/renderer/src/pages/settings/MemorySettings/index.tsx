/**
 * MemorySettings — main settings page for memory configuration.
 *
 * Sections:
 * 1. Global enable toggle + provider selector
 * 2. Bank strategy + user ID
 * 3. Auto-retain tuning
 * 4. Provider-specific settings (Hindsight / LibSql)
 * 5. Memory Browser (list/search/delete/reflect)
 */

import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import type { BankStrategy, MemoryProviderId } from '@shared/memory'
import { useTranslation } from 'react-i18next'

import {
  SettingContainer,
  SettingDescription,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingSubtitle,
  SettingTitle
} from '../index'
import { HindsightSettings } from './HindsightSettings'
import { LibSqlSettings } from './LibSqlSettings'
import { MemoryBrowser } from './MemoryBrowser'

export default function MemorySettings() {
  const { t } = useTranslation()

  const [enabled, setEnabled] = usePreference('feature.memory.enabled')
  const [provider, setProvider] = usePreference('feature.memory.provider')
  const [bankStrategy, setBankStrategy] = usePreference('feature.memory.bank_strategy')
  const [userId, setUserId] = usePreference('feature.memory.current_user_id')
  const [debounceMs, setDebounceMs] = usePreference('feature.memory.auto_retain_debounce_ms')
  const [batchSize, setBatchSize] = usePreference('feature.memory.auto_retain_batch_size')

  return (
    <SettingContainer>
      {/* Page title */}
      <SettingTitle>
        <span>{t('settings.memory.title', 'Memory')}</span>
      </SettingTitle>

      {/* Global enable */}
      <SettingGroup className="mt-4">
        <SettingRow>
          <div>
            <SettingRowTitle>{t('settings.memory.enabled', 'Enable Memory')}</SettingRowTitle>
            <SettingDescription className="mt-0">
              {t(
                'settings.memory.enabled_description',
                'Allow Cherry Studio to retain conversation context and recall relevant memories during chat.'
              )}
            </SettingDescription>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => setEnabled(v)} />
        </SettingRow>
      </SettingGroup>

      {enabled && (
        <>
          {/* Provider selection */}
          <SettingGroup>
            <SettingSubtitle>{t('settings.memory.provider_title', 'Provider')}</SettingSubtitle>

            <SettingRow className="mt-3">
              <div>
                <SettingRowTitle>{t('settings.memory.provider', 'Memory Provider')}</SettingRowTitle>
                {provider === 'off' && (
                  <SettingDescription className="mt-1">
                    {t(
                      'settings.memory.provider_off_tip',
                      'Select a provider to get started. Hindsight offers state-of-the-art long-term memory with entity tracking and temporal reasoning.'
                    )}
                  </SettingDescription>
                )}
              </div>
              <Select value={provider} onValueChange={(v) => setProvider(v as MemoryProviderId)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t('settings.memory.provider_off', 'Disabled')}</SelectItem>
                  <SelectItem value="libsql" disabled>
                    <span className="flex items-center gap-1.5">
                      {t('settings.memory.provider_libsql', 'Built-in (LibSQL)')}
                      <span className="rounded bg-orange-100 px-1 py-0.5 font-medium text-[10px] text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">
                        {t('settings.memory.coming_soon', 'Coming soon')}
                      </span>
                    </span>
                  </SelectItem>
                  <SelectItem value="hindsight">{t('settings.memory.provider_hindsight', 'Hindsight ✨')}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </SettingGroup>

          {/* Provider-specific config */}
          {provider === 'hindsight' && <HindsightSettings />}
          {provider === 'libsql' && <LibSqlSettings />}

          {/* Scope & bank strategy */}
          {provider !== 'off' && (
            <SettingGroup>
              <SettingSubtitle>{t('settings.memory.scope_title', 'Scope & Identity')}</SettingSubtitle>

              <div className="mt-3 space-y-3">
                <SettingRow>
                  <SettingRowTitle>{t('settings.memory.bank_strategy', 'Memory Scope')}</SettingRowTitle>
                  <Select value={bankStrategy} onValueChange={(v) => setBankStrategy(v as BankStrategy)}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">{t('settings.memory.strategy_global', 'Global (shared)')}</SelectItem>
                      <SelectItem value="per_user">{t('settings.memory.strategy_per_user', 'Per User')}</SelectItem>
                      <SelectItem value="per_assistant">
                        {t('settings.memory.strategy_per_assistant', 'Per Assistant')}
                      </SelectItem>
                      <SelectItem value="per_topic">{t('settings.memory.strategy_per_topic', 'Per Topic')}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>

                <SettingRow>
                  <SettingRowTitle>{t('settings.memory.user_id', 'Current User ID')}</SettingRowTitle>
                  <Input
                    className="w-48"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    placeholder="default-user"
                  />
                </SettingRow>
              </div>
            </SettingGroup>
          )}

          {/* Auto-retain tuning */}
          {provider !== 'off' && (
            <SettingGroup>
              <SettingSubtitle>{t('settings.memory.auto_retain_title', 'Auto-Retain Tuning')}</SettingSubtitle>
              <SettingDescription>
                {t(
                  'settings.memory.auto_retain_description',
                  'Conversation turns are batched and retained after a debounce interval. Adjust to balance latency and API calls.'
                )}
              </SettingDescription>

              <div className="mt-3 space-y-3">
                <SettingRow>
                  <SettingRowTitle>{t('settings.memory.debounce_ms', 'Debounce Interval (ms)')}</SettingRowTitle>
                  <Input
                    className="w-24"
                    type="number"
                    min={500}
                    max={30000}
                    step={500}
                    value={debounceMs}
                    onChange={(e) => setDebounceMs(Number(e.target.value))}
                  />
                </SettingRow>

                <SettingRow>
                  <SettingRowTitle>{t('settings.memory.batch_size', 'Batch Size')}</SettingRowTitle>
                  <Input
                    className="w-24"
                    type="number"
                    min={1}
                    max={50}
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                  />
                </SettingRow>
              </div>
            </SettingGroup>
          )}

          {/* Memory Browser */}
          {provider !== 'off' && (
            <SettingGroup>
              <SettingSubtitle>{t('settings.memory.browser_title', 'Memory Browser')}</SettingSubtitle>
              <div className="mt-3">
                <MemoryBrowser />
              </div>
            </SettingGroup>
          )}
        </>
      )}
    </SettingContainer>
  )
}
