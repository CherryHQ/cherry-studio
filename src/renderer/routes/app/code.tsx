import { createFileRoute } from '@tanstack/react-router'

import CodeCliPage from '@renderer/pages/code/CodeCliPage'

export const Route = createFileRoute('/app/code')({
  component: CodeCliPage
})
