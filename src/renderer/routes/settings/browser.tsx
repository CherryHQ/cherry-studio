import { createFileRoute } from '@tanstack/react-router'

import { BrowserSettings } from '@renderer/pages/settings/BrowserSettings'

export const Route = createFileRoute('/settings/browser')({ component: BrowserSettings })
