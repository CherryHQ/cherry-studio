import { createFileRoute } from '@tanstack/react-router'

import NotesPage from '@renderer/pages/notes/NotesPage'

export const Route = createFileRoute('/app/notes')({
  component: NotesPage
})
