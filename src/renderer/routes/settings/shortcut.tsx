import ShortcutSettings from '@renderer/pages/settings/ShortcutSettings'
import { type CommandId, findKeybindingRule } from '@shared/utils/command'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/shortcut')({
  component: ShortcutSettings,
  // `?command=<CommandId>` focuses one row. The id rather than the visible label on purpose:
  // labels are translated, so a link built from one breaks on a locale switch or a copy tweak,
  // silently. An id that no longer maps to a keybinding degrades to the plain list.
  validateSearch: (search: Record<string, unknown>): { command?: CommandId } => {
    const command = search.command
    if (typeof command !== 'string' || !findKeybindingRule(command as CommandId)) return {}
    return { command: command as CommandId }
  }
})
