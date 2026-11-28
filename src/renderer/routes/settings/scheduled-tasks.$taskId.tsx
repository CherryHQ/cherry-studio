import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/scheduled-tasks/$taskId')({
  validateSearch: (search: Record<string, unknown>): { notificationId?: string; runId?: string } => ({
    ...(typeof search.notificationId === 'string' && search.notificationId.trim()
      ? { notificationId: search.notificationId }
      : {}),
    ...(typeof search.runId === 'string' && search.runId.trim() ? { runId: search.runId } : {})
  }),
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/app/scheduled-tasks', search: { taskId: params.taskId, ...search }, replace: true })
  }
})
