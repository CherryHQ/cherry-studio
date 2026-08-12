import TasksSettings, { parseScheduledTaskDetailSearch } from '@renderer/pages/settings/TasksSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/scheduled-tasks/$taskId')({
  validateSearch: (search) => parseScheduledTaskDetailSearch(search),
  component: TasksSettings
})
