import { createFileRoute, redirect } from '@tanstack/react-router'

import { getAppEdition } from '@renderer/utils/appEdition'

export const Route = createFileRoute('/settings/subscription')({
  beforeLoad: () => {
    throw redirect({ to: getAppEdition() === 'global' ? '/settings/profile' : '/settings/provider' })
  }
})
