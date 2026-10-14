import { createFileRoute } from '@tanstack/react-router'

import TasksSettings from '@renderer/pages/settings/TasksSettings'

export const Route = createFileRoute('/settings/scheduled-tasks/$taskId')({
  component: TasksSettings
})
