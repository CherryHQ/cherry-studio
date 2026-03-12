/**
 * Migrator registration and exports
 */

export { BaseMigrator } from './BaseMigrator'

// Import all migrators
import { AssistantMigrator } from './AssistantMigrator'
import { ChatMigrator } from './ChatMigrator'
import { KnowledgeMigrator } from './KnowledgeMigrator'
import { PreferencesMigrator } from './PreferencesMigrator'
import { ProviderModelMigrator } from './ProviderModelMigrator'

// Export migrator classes
export { AssistantMigrator, ChatMigrator, KnowledgeMigrator, PreferencesMigrator, ProviderModelMigrator }

/**
 * Get all registered migrators in execution order
 */
export function getAllMigrators() {
  return [
    new PreferencesMigrator(), // order 1
    new ProviderModelMigrator(), // order 2
    new AssistantMigrator(), // order 3
    new KnowledgeMigrator(), // order 4
    new ChatMigrator() // order 5
  ]
}
