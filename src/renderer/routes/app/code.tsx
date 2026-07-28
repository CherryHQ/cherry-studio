import CodeCliPage from '@renderer/pages/code/CodeCliPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/code')({
  component: CodeCliPage
})
