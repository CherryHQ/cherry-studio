import { ReviewPage } from '@renderer/pages/englishLearning/ReviewPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/english-learning/review')({
  component: ReviewPage
})
