import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/scheduled-tasks/$taskId')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/app/scheduled-tasks', search: { taskId: params.taskId }, replace: true })
  }
})
