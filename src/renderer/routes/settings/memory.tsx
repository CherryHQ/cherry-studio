import { createFileRoute } from '@tanstack/react-router'

import { MemorySettings } from '@renderer/pages/settings/MemorySettings'

export const Route = createFileRoute('/settings/memory')({
  component: MemorySettings
})
