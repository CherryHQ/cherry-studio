import { createFileRoute } from '@tanstack/react-router'

import { DownloadsSettings } from '@renderer/pages/settings/DownloadsSettings'

export const Route = createFileRoute('/settings/downloads')({ component: DownloadsSettings })
