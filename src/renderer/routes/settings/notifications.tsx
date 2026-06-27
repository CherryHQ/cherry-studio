import NotificationSettings from '@renderer/pages/settings/NotificationSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/notifications')({
  component: NotificationSettings
})
