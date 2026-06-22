import { type QuickPanelInputAdapter, type QuickPanelListItem } from '@renderer/components/chat/composer/panelEngine'
import { ComposerPanelSymbol } from '@renderer/components/chat/composer/quickPanel/symbols'
import type { ComposerToolLauncher } from '@renderer/components/chat/composer/toolLauncher'
import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'
import { getBuiltinSlashCommands } from '@shared/ai/agentSlashCommands'
import { Terminal } from 'lucide-react'

const SLASH_COMMAND_DESCRIPTION_KEYS: Record<string, string> = {
  '/clear': 'chat.input.slash_commands.commands.clear',
  '/compact': 'chat.input.slash_commands.commands.compact',
  '/context': 'chat.input.slash_commands.commands.context',
  '/cost': 'chat.input.slash_commands.commands.cost',
  '/todos': 'chat.input.slash_commands.commands.todos'
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
 * - "/" root suggestion: Slash commands are grouped under one outer capability.
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
        const slashCommands = getBuiltinSlashCommands(session?.agentType)

        if (slashCommands.length === 0) {
          return []
        }

        const commandLaunchers: ComposerToolLauncher[] = slashCommands.map((cmd, index) => {
          const descriptionKey = SLASH_COMMAND_DESCRIPTION_KEYS[cmd.command]

          return {
            id: `slash-command:${cmd.command}`,
            kind: 'command' as const,
            sources: ['root-panel'] as const,
            order: 20 + (index + 1) / 100,
            label: cmd.command,
            description: descriptionKey ? t(descriptionKey, cmd.description || '') : cmd.description || '',
            icon: <Terminal size={16} />,
            action: ({ inputAdapter }) => {
              insertSlashCommand(cmd.command, actions.onTextChange, inputAdapter)
            }
          }
        })

        const rootLaunchers: ComposerToolLauncher[] = [
          {
            id: 'slash-commands',
            kind: 'group' as const,
            // Carrier entry: keep "/" root suggestions registered without showing a "+" menu row.
            sources: [] as const,
            order: 20,
            label: t('chat.input.slash_commands.title'),
            description: t('chat.input.slash_commands.description'),
            icon: <Terminal size={16} />,
            submenu: commandLaunchers,
            action: ({ quickPanel, inputAdapter, parentPanel, queryAnchor, triggerInfo }) => {
              const list: QuickPanelListItem[] = commandLaunchers.map((launcher) => ({
                label: launcher.label,
                description: launcher.description,
                icon: launcher.icon,
                action: (options) => {
                  launcher.action?.({
                    quickPanel: options.context,
                    inputAdapter: options.inputAdapter ?? inputAdapter,
                    parentPanel: options.parentPanel ?? parentPanel,
                    queryAnchor: options.queryAnchor ?? queryAnchor,
                    searchText: options.searchText,
                    source: 'root-panel',
                    triggerInfo: options.context.triggerInfo ?? triggerInfo
                  })
                }
              }))

              quickPanel.open({
                title: t('chat.input.slash_commands.title'),
                list,
                symbol: ComposerPanelSymbol.SlashCommands,
                parentPanel,
                queryAnchor,
                triggerInfo: triggerInfo ?? { type: 'button' }
              })
            }
          }
        ]

        return rootLaunchers
      }
    }
  }
})

// Register the tool
registerTool(slashCommandsTool)

export default slashCommandsTool
