import { createFileRoute } from '@tanstack/react-router'

import TasksSettings from '@renderer/pages/settings/TasksSettings'

export const Route = createFileRoute('/settings/scheduled-tasks/$taskId')({
  validateSearch: (search: Record<string, unknown>): { notificationId?: string } => ({
    notificationId: typeof search.notificationId === 'string' ? search.notificationId : undefined
  }),
  component: TaskNotificationRoute
})

function TaskNotificationRoute() {
  const { notificationId } = Route.useSearch()
  return <TasksSettings notificationId={notificationId} />
}
