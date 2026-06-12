import FilesPage from '@renderer/pages/files/FilesPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/files')({
  component: FilesPage
})
