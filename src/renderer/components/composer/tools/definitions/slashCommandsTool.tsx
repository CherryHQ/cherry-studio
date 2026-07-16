import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { defineTool, TopicType } from '@renderer/components/composer/tools/types'
import { type QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { getBuiltinSlashCommands } from '@shared/ai/agentSlashCommands'
import { Terminal } from 'lucide-react'

const SLASH_COMMAND_DESCRIPTION_KEYS: Record<string, string> = {
  '/clear': 'chat.input.slash_commands.commands.clear',
  '/compact': 'chat.input.slash_commands.commands.compact',
  '/context': 'chat.input.slash_commands.commands.context',
  '/usage': 'chat.input.slash_commands.commands.usage'
}

/**
 * Helper function to insert slash command through the composer adapter.
 * @param command - The command to insert (e.g., "/clear")
 */
export const insertSlashCommand = (
  command: string,
  onTextChange: (updater: (prev: string) => string) => void,
  inputAdapter?: QuickPanelInputAdapter
) => {
  if (inputAdapter) {
    inputAdapter.insertText(`${command} `)
    inputAdapter.focus()
    return
  }

  onTextChange((prev: string) => {
    const separator = prev.length > 0 && !/\s$/.test(prev) ? ' ' : ''
    return `${prev}${separator}${command} `
  })
}

/**
 * Slash Commands Tool
 *
 * Integrates Agent Session slash commands into the Inputbar.
 * Provides both a button UI and Composer menu integration.
 * Only visible in Agent Session (TopicType.Session).
 *
 * Menu structure:
 * - "/" root suggestion: each slash command is a flat root-panel row (no submenu).
 */
const slashCommandsTool = defineTool({
  key: 'slash_commands',
  label: (t) => t('chat.input.slash_commands.title'),

  // Only visible in Agent Session
  visibleInScopes: [TopicType.Session],

  dependencies: {
    actions: ['onTextChange'] as const
  },

  composer: {
    menuItems: {
      createItems: (context) => {
        const { session, actions, t } = context
        const slashCommandsLabel = t('chat.input.slash_commands.title')
        // Prefer the live SDK catalog for this session (custom commands included); fall back to the
        // static builtin list before the runtime has reported one (e.g. first paint, no run yet).
        const slashCommands = session?.slashCommands?.length
          ? session.slashCommands
          : getBuiltinSlashCommands(session?.agentType)

        if (slashCommands.length === 0) {
          return []
        }

        // Flat root-panel launchers: each slash command is its own "/" root suggestion row.
        // `sources: ['root-panel']` keeps them out of the "+" popover menu.
        const commandLaunchers: ComposerToolLauncher[] = slashCommands.map((cmd, index) => {
          const descriptionKey = SLASH_COMMAND_DESCRIPTION_KEYS[cmd.command]

          return {
            id: `slash-command:${cmd.command}`,
            kind: 'command' as const,
            sources: ['root-panel'] as const,
            // Render below caller additional items (e.g. agent skills) in the root panel.
            rootPanelPlacement: 'trailing' as const,
            order: 20 + (index + 1) / 100,
            label: cmd.command,
            description: descriptionKey ? t(descriptionKey, cmd.description || '') : cmd.description || '',
            searchAliases: [
              slashCommandsLabel,
              ...(descriptionKey ? getQuickPanelSearchAliases(t, descriptionKey) : [])
            ],
            icon: <Terminal size={16} />,
            action: ({ inputAdapter }) => {
              insertSlashCommand(cmd.command, actions.onTextChange, inputAdapter)
            }
          }
        })

        return commandLaunchers
      }
    }
  }
})

// Register the tool

export default slashCommandsTool
