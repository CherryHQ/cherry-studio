import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'

import NotesPage from '@renderer/pages/notes/NotesPage'
import { AbsoluteFilePathSchema } from '@shared/types/file'

export const Route = createFileRoute('/app/notes')({
  validateSearch: (search: Record<string, unknown>): { notePath?: string } => ({
    notePath: AbsoluteFilePathSchema.safeParse(search.notePath).data
  }),
  component: NotesRoute
})

function NotesRoute() {
  const { notePath } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleNoteOpened = useCallback(() => void navigate({ search: {}, replace: true }), [navigate])
  return <NotesPage notePath={notePath} onNoteOpened={handleNoteOpened} />
}
