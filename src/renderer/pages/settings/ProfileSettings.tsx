import { AccountSignOutButton } from '@renderer/components/AccountSignOutButton'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { UserProfileEditor } from '@renderer/components/UserProfileEditor'
import { getAppEdition } from '@renderer/utils/appEdition'

import { SubscriptionSettings } from './SubscriptionSettings'

export function ProfileSettings() {
  return (
    <SettingsContentColumn>
      <div className="space-y-6">
        <div id="setting-profile-profile">
          <UserProfileEditor />
        </div>
        {getAppEdition() === 'global' && <SubscriptionSettings />}
        <AccountSignOutButton />
      </div>
    </SettingsContentColumn>
  )
}
