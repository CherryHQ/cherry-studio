import { createFileRoute } from '@tanstack/react-router'

import ShortcutSettings from '@renderer/pages/settings/ShortcutSettings'

export const Route = createFileRoute('/settings/shortcut')({
  component: ShortcutSettings
})
