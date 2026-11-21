import { createFileRoute } from '@tanstack/react-router'

import ScheduledTasksPage from '@renderer/pages/agents/ScheduledTasksPage'

export const Route = createFileRoute('/app/scheduled-tasks')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Task/run/notification query values are unvalidated until the individual nonblank string checks below.
  validateSearch: (search: Record<string, unknown>) => {
    const params: { taskId?: string; runId?: string; notificationId?: string } = {}
    if (typeof search.taskId === 'string' && search.taskId.trim()) params.taskId = search.taskId
    if (typeof search.notificationId === 'string' && search.notificationId.trim())
      params.notificationId = search.notificationId
    if (typeof search.runId === 'string' && search.runId.trim()) params.runId = search.runId
    return params
  },
  component: ScheduledTasksPage
})
