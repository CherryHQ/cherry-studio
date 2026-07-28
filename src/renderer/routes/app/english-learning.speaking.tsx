import { SpeakingPage } from '@renderer/pages/englishLearning/SpeakingPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/english-learning/speaking')({
  component: SpeakingPage
})
