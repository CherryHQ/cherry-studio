import { EnglishLearningOverview } from '@renderer/pages/englishLearning/EnglishLearningOverview'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/english-learning/')({
  component: EnglishLearningOverview
})
