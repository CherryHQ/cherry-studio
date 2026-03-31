/**
 * Migrator registration and exports
 */

export { BaseMigrator } from './BaseMigrator'

// Import all migrators
import { AgentMigrator } from './AgentMigrator'
import { AssistantMigrator } from './AssistantMigrator'
import { BootConfigMigrator } from './BootConfigMigrator'
import { ChatMigrator } from './ChatMigrator'
import { KnowledgeMigrator } from './KnowledgeMigrator'
import { McpServerMigrator } from './McpServerMigrator'
import { PreferencesMigrator } from './PreferencesMigrator'
import { TranslateMigrator } from './TranslateMigrator'

// Export migrator classes
export {
  AgentMigrator,
  AssistantMigrator,
  BootConfigMigrator,
  ChatMigrator,
  KnowledgeMigrator,
  McpServerMigrator,
  PreferencesMigrator,
  TranslateMigrator
}

/**
 * Get all registered migrators in execution order
 */
export function getAllMigrators() {
  return [
    new BootConfigMigrator(),
    new PreferencesMigrator(),
    new McpServerMigrator(),
    new AssistantMigrator(),
    new KnowledgeMigrator(),
    new AgentMigrator(),
    new ChatMigrator(),
    new TranslateMigrator()
  ]
}
