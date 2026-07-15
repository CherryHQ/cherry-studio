/**
 * Migrator registration — assembles every migrator in execution order.
 */

/**
 * Get all registered migrators in execution order
 */
export async function getAllMigrators() {
  const [
    { AgentsMigrator },
    { AssistantMigrator },
    { BootConfigMigrator },
    { ChatMigrator },
    { FileMigrator },
    { KnowledgeMigrator },
    { KnowledgeVectorMigrator },
    { McpServerMigrator },
    { MiniAppMigrator },
    { NoteMigrator },
    { PaintingMigrator },
    { PreferencesMigrator },
    { PromptMigrator },
    { ProviderModelMigrator },
    { TranslateMigrator }
  ] = await Promise.all([
    import('./AgentsMigrator'),
    import('./AssistantMigrator'),
    import('./BootConfigMigrator'),
    import('./ChatMigrator'),
    import('./FileMigrator'),
    import('./KnowledgeMigrator'),
    import('./KnowledgeVectorMigrator'),
    import('./McpServerMigrator'),
    import('./MiniAppMigrator'),
    import('./NoteMigrator'),
    import('./PaintingMigrator'),
    import('./PreferencesMigrator'),
    import('./PromptMigrator'),
    import('./ProviderModelMigrator'),
    import('./TranslateMigrator')
  ])

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
