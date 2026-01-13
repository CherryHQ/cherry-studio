import NotesSettings from '@renderer/pages/notes/NotesSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/notes')({
  component: NotesSettings
})
