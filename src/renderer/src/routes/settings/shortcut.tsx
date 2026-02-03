import ShortcutSettings from '@renderer/pages/settings/ShortcutSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/shortcut')({
  component: ShortcutSettings
})
