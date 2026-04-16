/**
 * Migrator registration and exports
 */

export { BaseMigrator } from './BaseMigrator'

// Import all migrators
import { AssistantMigrator } from './AssistantMigrator'
import { BootConfigMigrator } from './BootConfigMigrator'
import { ChatMigrator } from './ChatMigrator'
import { KnowledgeMigrator } from './KnowledgeMigrator'
import { KnowledgeVectorMigrator } from './KnowledgeVectorMigrator'
import { McpServerMigrator } from './McpServerMigrator'
import { MiniAppMigrator } from './MiniAppMigrator'
import { PaintingMigrator } from './PaintingMigrator'
import { PreferencesMigrator } from './PreferencesMigrator'
import { ProviderModelMigrator } from './ProviderModelMigrator'
import { TranslateMigrator } from './TranslateMigrator'

// Export migrator classes
export {
  AssistantMigrator,
  BootConfigMigrator,
  ChatMigrator,
  KnowledgeMigrator,
  KnowledgeVectorMigrator,
  McpServerMigrator,
  MiniAppMigrator,
  PaintingMigrator,
  PreferencesMigrator,
  ProviderModelMigrator,
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
    new ProviderModelMigrator(),
    new AssistantMigrator(),
    new KnowledgeMigrator(),
    new KnowledgeVectorMigrator(),
    new ChatMigrator(),
    new PaintingMigrator(),
    new TranslateMigrator()
  ]
}
