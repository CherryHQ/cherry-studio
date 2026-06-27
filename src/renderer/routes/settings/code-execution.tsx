import CodeExecutionSettings from '@renderer/pages/settings/CodeExecutionSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/code-execution')({
  component: CodeExecutionSettings
})
