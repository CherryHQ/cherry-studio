import { createFileRoute } from '@tanstack/react-router'

import ShortcutSettings from '@renderer/pages/settings/ShortcutSettings'
import { findKeybindingRule } from '@shared/utils/command'

export const Route = createFileRoute('/settings/shortcut')({
  component: ShortcutSettings,
  // `?command=<CommandId>` focuses one row. The id rather than the visible label on purpose:
  // labels are translated, so a link built from one breaks on a locale switch or a copy tweak,
  // silently. An id that no longer maps to a keybinding degrades to the plain list.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Query values are untrusted until the string check and keybinding lookup identify a supported command.
  validateSearch: (search: Record<string, unknown>) => {
    const command = search.command
    const rule = typeof command === 'string' ? findKeybindingRule(command) : undefined

    if (!rule) return {}

    return { command: rule.command }
  }
})
