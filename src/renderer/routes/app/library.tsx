import LibraryPage from '@renderer/pages/library/LibraryPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/library')({
  component: LibraryPage
})
