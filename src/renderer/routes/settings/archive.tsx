import { createFileRoute } from '@tanstack/react-router'

import ArchiveSettings from '@renderer/pages/settings/ArchiveSettings/ArchiveSettings'

export const Route = createFileRoute('/settings/archive')({ component: ArchiveSettings })
