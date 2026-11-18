import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/scheduled-tasks/$taskId')({
  validateSearch: (search: Record<string, unknown>): { notificationId?: string } => {
    const result: { notificationId?: string } = {}
    if (typeof search.notificationId === 'string' && search.notificationId.trim()) {
      result.notificationId = search.notificationId
    }
    return result
  },
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/app/scheduled-tasks', search: { taskId: params.taskId, ...search }, replace: true })
  }
})
