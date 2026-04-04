/**
 * Migrator registration and exports
 */

export { BaseMigrator } from './BaseMigrator'

// Import all migrators
import { AssistantMigrator } from './AssistantMigrator'
import { BootConfigMigrator } from './BootConfigMigrator'
import { ChatMigrator } from './ChatMigrator'
import { KnowledgeMigrator } from './KnowledgeMigrator'
import { McpServerMigrator } from './McpServerMigrator'
import { MiniAppMigrator } from './MiniAppMigrator'
import { PreferencesMigrator } from './PreferencesMigrator'
import { TranslateMigrator } from './TranslateMigrator'

// Export migrator classes
export {
  AssistantMigrator,
  BootConfigMigrator,
  ChatMigrator,
  KnowledgeMigrator,
  McpServerMigrator,
  MiniAppMigrator,
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
    new MiniAppMigrator(),
    new McpServerMigrator(),
    new AssistantMigrator(),
    new KnowledgeMigrator(),
    new ChatMigrator(),
    new TranslateMigrator()
  ]
}
