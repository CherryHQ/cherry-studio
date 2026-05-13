/**
 * Migrator registration and exports
 */

export { BaseMigrator } from './BaseMigrator'

// Import all migrators
import { AgentsMigrator } from './AgentsMigrator'
import { AssistantMigrator } from './AssistantMigrator'
import { BootConfigMigrator } from './BootConfigMigrator'
import { ChatMigrator } from './ChatMigrator'
import { FileMigrator } from './FileMigrator'
import { KnowledgeMigrator } from './KnowledgeMigrator'
import { KnowledgeVectorMigrator } from './KnowledgeVectorMigrator'
import { McpServerMigrator } from './McpServerMigrator'
import { MiniAppMigrator } from './MiniAppMigrator'
import { PreferencesMigrator } from './PreferencesMigrator'
import { PromptMigrator } from './PromptMigrator'
import { ProviderModelMigrator } from './ProviderModelMigrator'
import { TranslateMigrator } from './TranslateMigrator'

// Export migrator classes
export {
  AgentsMigrator,
  AssistantMigrator,
  BootConfigMigrator,
  ChatMigrator,
  FileMigrator,
  KnowledgeMigrator,
  KnowledgeVectorMigrator,
  McpServerMigrator,
  MiniAppMigrator,
  PreferencesMigrator,
  PromptMigrator,
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
    new FileMigrator(),
    new AgentsMigrator(),
    new KnowledgeMigrator(),
    new KnowledgeVectorMigrator(),
    new ChatMigrator(),
    new TranslateMigrator(),
    new PromptMigrator()
  ]
}
