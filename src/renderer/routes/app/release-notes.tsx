import { createFileRoute } from '@tanstack/react-router'

import ReleaseNotesPage from '@renderer/pages/releaseNotes/ReleaseNotesPage'

export const Route = createFileRoute('/app/release-notes')({
  component: ReleaseNotesPage
})
