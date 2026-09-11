import { createFileRoute } from '@tanstack/react-router'

import KnowledgePage from '@renderer/pages/knowledge/KnowledgePage'

export const Route = createFileRoute('/app/knowledge')({
  component: KnowledgePage
})
