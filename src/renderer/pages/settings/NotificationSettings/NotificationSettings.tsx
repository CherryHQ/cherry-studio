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
import { isMac } from '@renderer/utils/platform'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const NotificationSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [notificationSettings, setNotificationSettings] = useMultiplePreferences({
    assistant: 'app.notification.assistant.enabled',
    backup: 'app.notification.backup.enabled',
    knowledge: 'app.notification.knowledge.enabled',
    update: 'app.notification.update.enabled'
  })
  const [conversationIslandSettings, setConversationIslandSettings] = useMultiplePreferences({
    enabled: 'feature.conversation_island.enabled',
    showTitle: 'feature.conversation_island.show_title'
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
        {isMac && (
          <>
            <SettingDivider />
            <SettingRow>
              <SettingRowTitle>{t('settings.notification.conversation_island.enabled')}</SettingRowTitle>
              <Switch
                aria-label={t('settings.notification.conversation_island.enabled')}
                checked={conversationIslandSettings.enabled}
                onCheckedChange={(enabled) => void setConversationIslandSettings({ enabled })}
              />
            </SettingRow>
            {conversationIslandSettings.enabled && (
              <>
                <SettingDivider />
                <SettingRow>
                  <SettingRowTitle>{t('settings.notification.conversation_island.show_title')}</SettingRowTitle>
                  <Switch
                    aria-label={t('settings.notification.conversation_island.show_title')}
                    checked={conversationIslandSettings.showTitle}
                    onCheckedChange={(showTitle) => void setConversationIslandSettings({ showTitle })}
                  />
                </SettingRow>
              </>
            )}
          </>
        )}
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default NotificationSettings
