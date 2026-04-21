import KnowledgeV2Page from '@renderer/pages/knowledge.v2/KnowledgeV2Page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/knowledge')({
  component: KnowledgeV2Page
})
