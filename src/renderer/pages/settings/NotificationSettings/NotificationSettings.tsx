import { InfoTooltip, SettingsPageHeader, Switch } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import {
  SettingCard,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import type { NotificationSource } from '@renderer/types/notification'
import { Bell } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const NotificationSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [notificationSettings, setNotificationSettings] = useMultiplePreferences({
    assistant: 'app.notification.assistant.enabled',
    backup: 'app.notification.backup.enabled',
    knowledge: 'app.notification.knowledge.enabled'
  })

  const handleNotificationChange = (type: NotificationSource, value: boolean) => {
    void setNotificationSettings({ [type]: value })
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingsPageHeader
          icon={<Bell />}
          title={t('settings.notification.title')}
          description={t('settings.notification.description')}
        />
        <SettingCard>
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
          <SettingRow>
            <SettingRowTitle>{t('settings.notification.backup')}</SettingRowTitle>
            <Switch
              checked={notificationSettings.backup}
              onCheckedChange={(v) => handleNotificationChange('backup', v)}
            />
          </SettingRow>
          <SettingRow>
            <SettingRowTitle>{t('settings.notification.knowledge_embed')}</SettingRowTitle>
            <Switch
              checked={notificationSettings.knowledge}
              onCheckedChange={(v) => handleNotificationChange('knowledge', v)}
            />
          </SettingRow>
        </SettingCard>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default NotificationSettings
