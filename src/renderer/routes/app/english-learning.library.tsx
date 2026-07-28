import { LibraryPage } from '@renderer/pages/englishLearning/LibraryPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/english-learning/library')({
  component: LibraryPage
})
