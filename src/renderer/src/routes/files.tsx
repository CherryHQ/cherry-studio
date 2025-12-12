import FilesPage from '@renderer/pages/files/FilesPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/files')({
  component: FilesPage
})
