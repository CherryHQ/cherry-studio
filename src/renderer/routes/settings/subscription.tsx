import { createFileRoute, redirect } from '@tanstack/react-router'

import { SubscriptionSettings } from '@renderer/pages/settings/SubscriptionSettings'
import { getAppEdition } from '@renderer/utils/appEdition'

export const Route = createFileRoute('/settings/subscription')({
  beforeLoad: () => {
    if (getAppEdition() !== 'global') throw redirect({ to: '/settings/provider' })
  },
  component: SubscriptionSettings
})
