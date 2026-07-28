import KnowledgePage from '@renderer/pages/knowledge/KnowledgePage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/knowledge')({
  component: KnowledgePage
})
