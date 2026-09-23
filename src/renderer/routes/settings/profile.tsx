import { createFileRoute } from '@tanstack/react-router'

import { ProfileSettings } from '@renderer/pages/settings/ProfileSettings'

export const Route = createFileRoute('/settings/profile')({
  component: ProfileSettings
})
