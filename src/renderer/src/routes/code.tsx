import CodeToolsPage from '@renderer/pages/code/CodeToolsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/code')({
  component: CodeToolsPage
})
