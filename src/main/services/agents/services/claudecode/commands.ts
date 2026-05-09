// Re-export so existing main-process imports keep working; the canonical list
// lives in `@shared/data/types/agentSlashCommands` so the renderer can import
// it without crossing the main/renderer boundary.
import type { SlashCommand } from '@shared/data/types/agent'
import { getBuiltinSlashCommands } from '@shared/data/types/agentSlashCommands'

export const builtinSlashCommands: SlashCommand[] = getBuiltinSlashCommands('claude-code')
