import { InfoTooltip, Switch } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import type { NotificationSource } from '@renderer/types/notification'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const NotificationSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [notificationSettings, setNotificationSettings] = useMultiplePreferences({
    assistant: 'app.notification.assistant.enabled',
    backup: 'app.notification.backup.enabled',
    knowledge: 'app.notification.knowledge.enabled',
    update: 'app.notification.update.enabled',
    'mini-app': 'app.notification.mini_app.enabled'
  })

  const handleNotificationChange = (type: NotificationSource, value: boolean) => {
    void setNotificationSettings({ [type]: value })
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.notification.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{t('settings.notification.assistant')}</span>
            <InfoTooltip
              content={t('notification.tip')}
              placement="right"
              iconProps={{ className: 'cursor-pointer' }}
            />
          </SettingRowTitle>
          <Switch
            checked={notificationSettings.assistant}
            onCheckedChange={(v) => handleNotificationChange('assistant', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.backup')}</SettingRowTitle>
          <Switch
            checked={notificationSettings.backup}
            onCheckedChange={(v) => handleNotificationChange('backup', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.knowledge_embed')}</SettingRowTitle>
          <Switch
            checked={notificationSettings.knowledge}
            onCheckedChange={(v) => handleNotificationChange('knowledge', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.notification.update')}</SettingRowTitle>
          <Switch
            aria-label={t('settings.notification.update')}
            checked={notificationSettings.update}
            onCheckedChange={(v) => handleNotificationChange('update', v)}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
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
