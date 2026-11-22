import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/scheduled-tasks/$taskId')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The notification query is unvalidated until its nonblank string check; redirect only the accepted value.
  validateSearch: (search: Record<string, unknown>) => {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- The router requires an optional search field; absent notification IDs must not become explicit undefined values.
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
