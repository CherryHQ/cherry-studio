// Re-export so existing main-process imports keep working; the canonical list
// lives in `@shared/data/types/agentSlashCommands` so the renderer can import
// it without crossing the main/renderer boundary.
import { getBuiltinSlashCommands } from '@shared/data/types/agentSlashCommands'
import type { SlashCommand } from '@types'

export const builtinSlashCommands: SlashCommand[] = getBuiltinSlashCommands('claude-code')
