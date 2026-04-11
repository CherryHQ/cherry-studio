import TasksSettings from '@renderer/pages/settings/TasksSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/scheduled-tasks')({
  component: TasksSettings
})
