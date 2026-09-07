import { BrowserSettings } from '@renderer/pages/settings/BrowserSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/browser')({ component: BrowserSettings })
