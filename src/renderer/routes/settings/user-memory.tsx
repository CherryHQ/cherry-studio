import { createFileRoute } from '@tanstack/react-router'

import { UserMemorySettings } from '@renderer/pages/settings/UserMemorySettings'

export const Route = createFileRoute('/settings/user-memory')({
  component: UserMemorySettings
})
