/**
 * Migrator registration and exports
 */

export { BaseMigrator } from './BaseMigrator'

// Import all migrators
import { AssistantMigrator } from './AssistantMigrator'
import { ChatMigrator } from './ChatMigrator'
import { KnowledgeMigrator } from './KnowledgeMigrator'
import { PreferencesMigrator } from './PreferencesMigrator'
import { PromptMigrator } from './PromptMigrator'

// Export migrator classes
export { AssistantMigrator, ChatMigrator, KnowledgeMigrator, PreferencesMigrator, PromptMigrator }

/**
 * Get all registered migrators in execution order
 */
export function getAllMigrators() {
  return [
    new PreferencesMigrator(),
    new AssistantMigrator(),
    new KnowledgeMigrator(),
    new ChatMigrator(),
    new PromptMigrator()
  ]
}
