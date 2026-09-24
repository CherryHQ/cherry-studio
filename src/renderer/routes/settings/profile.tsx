import { createFileRoute, redirect } from '@tanstack/react-router'

import { ProfileSettings } from '@renderer/pages/settings/ProfileSettings'
import { getAppEdition } from '@renderer/utils/appEdition'

export const Route = createFileRoute('/settings/profile')({
  beforeLoad: () => {
    if (getAppEdition() === 'cn') throw redirect({ to: '/settings/provider' })
  },
  component: ProfileSettings
})
