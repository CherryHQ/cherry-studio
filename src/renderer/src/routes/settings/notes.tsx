import NotesSettings from '@renderer/pages/settings/NotesSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/notes')({
  component: NotesSettings
})
