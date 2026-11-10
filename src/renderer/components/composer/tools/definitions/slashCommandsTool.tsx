import { Target, Terminal } from 'lucide-react'

import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { defineTool, TopicType } from '@renderer/components/composer/tools/types'
import { type QuickPanelInputAdapter } from '@renderer/components/QuickPanel'

import { getBuiltinSlashCommands } from './agentSlashCommands'

const SLASH_COMMAND_DESCRIPTION_KEYS: Record<string, string> = {
  '/clear': 'chat.input.slash_commands.commands.clear',
  '/compact': 'chat.input.slash_commands.commands.compact',
  '/context': 'chat.input.slash_commands.commands.context',
  '/goal': 'chat.input.slash_commands.commands.goal',
  '/insights': 'chat.input.slash_commands.commands.insights',
  '/list-agents': 'chat.input.slash_commands.commands.list_agents',
  '/recap': 'chat.input.slash_commands.commands.recap',
  '/security-review': 'chat.input.slash_commands.commands.security_review',
  '/team-onboarding': 'chat.input.slash_commands.commands.team_onboarding',
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
        const liveCommands = session?.slashCommands?.length ? session.slashCommands : undefined
        const slashCommands: NonNullable<typeof liveCommands> =
          liveCommands ?? getBuiltinSlashCommands(session?.agentType)

        if (slashCommands.length === 0) {
          return []
        }

        // Goal is a mode entry; other slash commands remain trailing root suggestions.
        const commandLaunchers: ComposerToolLauncher[] = slashCommands.map((cmd, index) => {
          const isGoal = cmd.command === '/goal' && cmd.builtin !== false
          const descriptionKey = liveCommands
            ? cmd.builtin === true
              ? SLASH_COMMAND_DESCRIPTION_KEYS[cmd.command]
              : undefined
            : SLASH_COMMAND_DESCRIPTION_KEYS[cmd.command]

          return {
            id: `slash-command:${cmd.command}`,
            kind: 'command' as const,
            sources: isGoal ? ['popover', 'root-panel'] : ['root-panel'],
            rootPanelPlacement: isGoal ? undefined : 'trailing',
            order: isGoal ? 79.5 : 20 + (index + 1) / 100,
            label: isGoal ? t('agent.input.goal_mode.title') : cmd.command,
            description: descriptionKey ? t(descriptionKey, cmd.description || '') : cmd.description || '',
            searchAliases: [
              slashCommandsLabel,
              ...(isGoal ? [cmd.command] : []),
              ...(descriptionKey ? getQuickPanelSearchAliases(t, descriptionKey) : [])
            ],
            icon: isGoal ? <Target size={16} /> : <Terminal size={16} />,
            action: ({ inputAdapter }) => {
              if (isGoal) {
                if (inputAdapter) {
                  if (!/^\/goal(?:\s|$)/.test(inputAdapter.getText())) {
                    inputAdapter.insertText('/goal ', { position: 'start' })
                  }
                  inputAdapter.focus()
                } else {
                  actions.onTextChange((prev) => (/^\/goal(?:\s|$)/.test(prev) ? prev : `/goal ${prev}`))
                }
                return
              }
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
