import { loggerService } from '@logger'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import SlashCommandsButton from '@renderer/pages/home/Inputbar/tools/components/SlashCommandsButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { Terminal } from 'lucide-react'

const logger = loggerService.withContext('SlashCommandsTool')

/**
 * Helper function to insert slash command into textarea
 * @param command - The command to insert (e.g., "/clear")
 * @param replaceSlash - Whether to replace the preceding '/' character
 */
const insertSlashCommand = (
  command: string,
  onTextChange: (updater: (prev: string) => string) => void,
  replaceSlash: boolean = false
) => {
  onTextChange((prev: string) => {
    const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null

    if (!textArea) {
      logger.warn('TextArea not found')
      return prev + ' ' + command
    }

    const cursorPosition = textArea.selectionStart || 0

    let newText: string
    let newCursorPos: number

    if (replaceSlash) {
      // Find the '/' that triggered the menu
      const textBeforeCursor = prev.slice(0, cursorPosition)
      const lastSlashIndex = textBeforeCursor.lastIndexOf('/')

      if (lastSlashIndex !== -1 && cursorPosition > lastSlashIndex) {
        // Replace from '/' to cursor with command
        newText = prev.slice(0, lastSlashIndex) + command + ' ' + prev.slice(cursorPosition)
        newCursorPos = lastSlashIndex + command.length + 1
      } else {
        // No '/' found, just insert at cursor
        newText = prev.slice(0, cursorPosition) + command + ' ' + prev.slice(cursorPosition)
        newCursorPos = cursorPosition + command.length + 1
      }
    } else {
      // Just insert at cursor position
      newText = prev.slice(0, cursorPosition) + command + ' ' + prev.slice(cursorPosition)
      newCursorPos = cursorPosition + command.length + 1
    }

    // Set cursor position after the inserted command
    setTimeout(() => {
      if (textArea) {
        textArea.focus()
        textArea.setSelectionRange(newCursorPos, newCursorPos)
        logger.debug('Cursor set', { newCursorPos })
      }
    }, 0)

    return newText
  })
}

/**
 * Slash Commands Tool
 *
 * Integrates Agent Session slash commands into the Inputbar.
 * Provides both a button UI and declarative QuickPanel integration.
 * Only visible in Agent Session (TopicType.Session).
 *
 * Menu structure (declarative):
 * - First level: "Slash Commands" parent menu item (isMenu: true) in "/" root menu
 * - Second level: Individual slash commands opened via SlashCommands trigger
 */
const slashCommandsTool = defineTool({
  key: 'slash_commands',
  label: (t) => t('chat.input.slash_commands'),

  // Only visible in Agent Session
  visibleInScopes: [TopicType.Session],

  dependencies: {
    actions: ['onTextChange'] as const
  },

  // Declarative QuickPanel configuration
  quickPanel: {
    // Root menu contribution (first level menu item)
    rootMenu: {
      createMenuItems: (context) => {
        const { t, session, actions, quickPanelController } = context
        const slashCommands = session?.slashCommands || []

        // Only show menu item if there are commands
        if (slashCommands.length === 0) {
          return []
        }

        return [
          {
            label: t('chat.input.slash_commands.title'),
            description: t('chat.input.slash_commands.description', 'Agent session slash commands'),
            icon: <Terminal size={16} />,
            isMenu: true, // Mark as parent menu item (first level)
            action: () => {
              // Close root panel and open secondary panel
              quickPanelController.close()
              setTimeout(() => {
                quickPanelController.open({
                  title: t('chat.input.slash_commands.title'),
                  symbol: QuickPanelReservedSymbol.SlashCommands,
                  list: slashCommands.map((cmd) => ({
                    label: cmd.command,
                    description: cmd.description || '',
                    icon: <Terminal size={16} />,
                    filterText: `${cmd.command} ${cmd.description || ''}`,
                    action: () => {
                      // Replace the '/' that triggered the root menu
                      insertSlashCommand(cmd.command, actions.onTextChange, true)
                    }
                  }))
                })
              }, 0)
            }
          }
        ]
      }
    },

    // Trigger configuration (allows direct access via symbol)
    triggers: [
      {
        symbol: QuickPanelReservedSymbol.SlashCommands,
        createHandler: (context) => {
          const { session, actions, quickPanelController, t } = context

          return () => {
            const slashCommands = session?.slashCommands || []

            if (slashCommands.length === 0) {
              quickPanelController.open({
                title: t('chat.input.slash_commands'),
                symbol: QuickPanelReservedSymbol.SlashCommands,
                list: [
                  {
                    label: t('chat.input.slash_commands.empty', 'No slash commands available'),
                    description: '',
                    icon: <Terminal size={16} />,
                    disabled: true,
                    action: () => {}
                  }
                ]
              })
              return
            }

            quickPanelController.open({
              title: t('chat.input.slash_commands'),
              symbol: QuickPanelReservedSymbol.SlashCommands,
              list: slashCommands.map((cmd) => ({
                label: cmd.command,
                description: cmd.description || '',
                icon: <Terminal size={16} />,
                filterText: `${cmd.command} ${cmd.description || ''}`,
                action: () => {
                  // Direct insert (no '/' to replace when triggered directly)
                  insertSlashCommand(cmd.command, actions.onTextChange, false)
                }
              }))
            })
          }
        }
      }
    ]
  },

  // Render button UI
  render: (context) => {
    const { session, actions, quickPanelController, t } = context

    // Pass the handler function to the button so it can open the panel
    const openPanel = () => {
      const slashCommands = session?.slashCommands || []

      if (slashCommands.length === 0) {
        quickPanelController.open({
          title: t('chat.input.slash_commands'),
          symbol: QuickPanelReservedSymbol.SlashCommands,
          list: [
            {
              label: t('chat.input.slash_commands.empty', 'No slash commands available'),
              description: '',
              icon: <Terminal size={16} />,
              disabled: true,
              action: () => {}
            }
          ]
        })
        return
      }

      quickPanelController.open({
        title: t('chat.input.slash_commands'),
        symbol: QuickPanelReservedSymbol.SlashCommands,
        list: slashCommands.map((cmd) => ({
          label: cmd.command,
          description: cmd.description || '',
          icon: <Terminal size={16} />,
          filterText: `${cmd.command} ${cmd.description || ''}`,
          action: () => {
            // Direct insert (no '/' to replace when opening via button)
            insertSlashCommand(cmd.command, actions.onTextChange, false)
          }
        }))
      })
    }

    return <SlashCommandsButton quickPanelController={quickPanelController} session={session} openPanel={openPanel} />
  }
})

// Register the tool
registerTool(slashCommandsTool)

export default slashCommandsTool
