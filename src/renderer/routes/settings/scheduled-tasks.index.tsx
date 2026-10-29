import { createFileRoute } from '@tanstack/react-router'

import TasksSettings from '@renderer/pages/settings/TasksSettings'

export const Route = createFileRoute('/settings/scheduled-tasks/')({
  validateSearch: (search: Record<string, unknown>): { create?: boolean } => ({
    create: search.create === true || search.create === 'true' ? true : undefined
  }),
  component: TasksSettings
})
