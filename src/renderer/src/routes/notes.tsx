import NotesPage from '@renderer/pages/notes/NotesPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/notes')({
  component: NotesPage
})
