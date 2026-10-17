import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { InfoTooltip, InputNumber, Switch } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { toast } from '@renderer/services/toast'
import type { NotificationSource } from '@renderer/types/notification'

const logger = loggerService.withContext('NotificationSettings')

const NotificationSettings: FC = () => {
  const { t } = useTranslation()
  const categoryLabels = {
    system: t('notification.center.system'),
    usage: t('notification.center.usage'),
    official: t('notification.center.official')
  }
  const { theme } = useTheme()

  const [notificationSettings, setNotificationSettings] = useMultiplePreferences({
    assistant: 'app.notification.assistant.enabled',
    backup: 'app.notification.backup.enabled',
    knowledge: 'app.notification.knowledge.enabled',
    update: 'app.notification.update.enabled',
    'mini-app': 'app.notification.mini_app.enabled',
    system: 'app.notification.center.system.enabled',
    usage: 'app.notification.center.usage.enabled',
    official: 'app.notification.center.official.enabled',
    usagePopups: 'app.notification.usage.os.enabled',
    completionSound: 'app.notification.completion_sound.enabled',
    budget: 'app.notification.daily_budget.tokens',
    threshold: 'app.notification.daily_budget.threshold'
  })

  const saveSettings = (values: Partial<typeof notificationSettings>) =>
    setNotificationSettings(values).catch((error) => {
      logger.error('Failed to save notification settings', error as Error)
      toast.error(t('common.error'))
    })

  const handleNotificationChange = (type: NotificationSource, value: boolean) => {
    void saveSettings({ [type]: value })
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.notification.center')}</SettingTitle>
        <p className="my-3 text-sm text-muted-foreground">{t('settings.notification.center_hint')}</p>
        {(['system', 'usage', 'official'] as const).map((category) => (
          <SettingRow key={category} id={`setting-notifications-${category}-center`} className="my-3 scroll-mt-6">
            <SettingRowTitle>{categoryLabels[category]}</SettingRowTitle>
            <Switch
              aria-label={categoryLabels[category]}
              checked={notificationSettings[category]}
              onCheckedChange={(value) => void saveSettings({ [category]: value })}
            />
          </SettingRow>
        ))}
        <SettingDivider />
        <SettingRow id="setting-notifications-completion-sound" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.completion_sound')}</SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.completion_sound')}
            checked={notificationSettings.completionSound}
            onCheckedChange={(value) => void saveSettings({ completionSound: value })}
          />
        </SettingRow>
        <p className="mt-2 text-sm text-muted-foreground">{t('settings.notification.sound_hint')}</p>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('notification.center.usage')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-notifications-daily-budget" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.daily_budget')}</SettingRowTitle>
          <div className="relative w-28">
            <InputNumber
              className="w-full pr-7"
              aria-label={`${t('settings.notification.daily_budget')} (k)`}
              value={notificationSettings.budget ? notificationSettings.budget / 1000 : null}
              min={0}
              max={Number.MAX_SAFE_INTEGER / 1000}
              step={0.1}
              onBlur={(value) => {
                const budget = Math.round((value ?? 0) * 1000)
                if (!Number.isSafeInteger(budget) || budget < 0) return
                return saveSettings({ budget })
              }}
            />
            <span
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
              aria-hidden="true">
              k
            </span>
          </div>
        </SettingRow>
        <p className="my-2 text-sm text-muted-foreground">{t('settings.notification.daily_budget_hint')}</p>
        <SettingDivider />
        <SettingRow id="setting-notifications-daily-threshold" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.daily_threshold')}</SettingRowTitle>
          <InputNumber
            className="w-28"
            aria-label={t('settings.notification.daily_threshold')}
            value={notificationSettings.threshold}
            min={1}
            max={100}
            step={1}
            onBlur={(value) => {
              const threshold = value ?? 80
              if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) return
              return saveSettings({ threshold })
            }}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.notification.popups')}</SettingTitle>
        <SettingDivider />
        <SettingRow id="setting-notifications-system-popups" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.system_popups')}</SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.system_popups')}
            checked={notificationSettings.assistant || notificationSettings.backup || notificationSettings.knowledge}
            onCheckedChange={(value) => void saveSettings({ assistant: value, backup: value, knowledge: value })}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-notifications-assistant-notification" className="scroll-mt-6">
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.notification.assistant')}</span>
            <InfoTooltip
              content={t('notification.tip')}
              placement="right"
              iconProps={{ className: 'cursor-pointer' }}
            />
          </SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.assistant')}
            checked={notificationSettings.assistant}
            onCheckedChange={(v) => handleNotificationChange('assistant', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-notifications-backup-notification" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.backup')}</SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.backup')}
            checked={notificationSettings.backup}
            onCheckedChange={(v) => handleNotificationChange('backup', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-notifications-knowledge-embed-notification" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.knowledge_embed')}</SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.knowledge_embed')}
            checked={notificationSettings.knowledge}
            onCheckedChange={(v) => handleNotificationChange('knowledge', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-notifications-usage-popups" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.usage_popups')}</SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.usage_popups')}
            checked={notificationSettings.usagePopups}
            onCheckedChange={(value) => void saveSettings({ usagePopups: value })}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-notifications-update-notification" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.update')}</SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.update')}
            checked={notificationSettings.update}
            onCheckedChange={(v) => handleNotificationChange('update', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow id="setting-notifications-mini-app-notification" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.notification.mini_app')}</SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.mini_app')}
            checked={notificationSettings['mini-app']}
            onCheckedChange={(v) => handleNotificationChange('mini-app', v)}
          />
        </SettingRow>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default NotificationSettings
