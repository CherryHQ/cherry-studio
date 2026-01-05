import AssistantPresetsPage from '@renderer/pages/store/assistants/presets/AssistantPresetsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/assistant')({
  component: AssistantPresetsPage
})
