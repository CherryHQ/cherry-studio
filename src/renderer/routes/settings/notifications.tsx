import { createFileRoute } from '@tanstack/react-router'

import { NotificationSettings } from '@renderer/pages/settings/NotificationSettings'

export const Route = createFileRoute('/settings/notifications')({
  component: NotificationSettings
})
