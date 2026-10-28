import { useTranslation } from 'react-i18next'

import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { UserProfileEditor } from '@renderer/components/UserProfileEditor'

import { SubscriptionSettings } from './SubscriptionSettings'

export function ProfileSettings() {
  const { t } = useTranslation()

  return (
    <SettingsContentColumn>
      <div className="space-y-6">
        <h2 className="text-[15px] font-semibold">{t('settings.profile.title')}</h2>
        <div id="setting-profile-profile">
          <UserProfileEditor />
        </div>
        <SubscriptionSettings />
      </div>
    </SettingsContentColumn>
  )
}
