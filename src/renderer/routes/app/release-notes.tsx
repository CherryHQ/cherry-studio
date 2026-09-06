import ReleaseNotesPage from '@renderer/pages/releaseNotes/ReleaseNotesPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/release-notes')({
  component: ReleaseNotesPage
})
