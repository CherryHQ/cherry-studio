import { getBuiltinSlashCommands } from '@shared/ai/agentSlashCommands'
import type { SlashCommand } from '@shared/ai/slashCommands'

export const builtinSlashCommands: SlashCommand[] = getBuiltinSlashCommands('claude-code')
