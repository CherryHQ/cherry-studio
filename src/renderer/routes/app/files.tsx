import { createFileRoute } from '@tanstack/react-router'

import FilesPage from '@renderer/pages/files/FilesPage'

export const Route = createFileRoute('/app/files')({
  component: FilesPage
})
