import MemorySettings from '@renderer/pages/settings/MemorySettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/memory')({
  component: MemorySettings
})
