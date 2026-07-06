/**
 * Migrator registration — assembles every migrator in execution order.
 */

import { AgentsMigrator } from './AgentsMigrator'
import { AssistantMigrator } from './AssistantMigrator'
import { BootConfigMigrator } from './BootConfigMigrator'
import { ChatMigrator } from './ChatMigrator'
import { FileMigrator } from './FileMigrator'
import { KnowledgeMigrator } from './KnowledgeMigrator'
import { KnowledgeVectorMigrator } from './KnowledgeVectorMigrator'
import { McpServerMigrator } from './McpServerMigrator'
import { MiniAppMigrator } from './MiniAppMigrator'
import { NoteMigrator } from './NoteMigrator'
import { PaintingMigrator } from './PaintingMigrator'
import { PreferencesMigrator } from './PreferencesMigrator'
import { PromptMigrator } from './PromptMigrator'
import { ProviderModelMigrator } from './ProviderModelMigrator'
import { TranslateMigrator } from './TranslateMigrator'

/**
 * Get all registered migrators in execution order
 */
export function getAllMigrators() {
  return [
    new BootConfigMigrator(),
    new PreferencesMigrator(),
    new NoteMigrator(),
    new MiniAppMigrator(),
    new McpServerMigrator(),
    new ProviderModelMigrator(),
    new AssistantMigrator(),
    new FileMigrator(),
    new AgentsMigrator(),
    new KnowledgeMigrator(),
    new KnowledgeVectorMigrator(),
    new ChatMigrator(),
    new PaintingMigrator(),
    new TranslateMigrator(),
    new PromptMigrator()
  ]
}
