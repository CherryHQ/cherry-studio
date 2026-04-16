/**
 * Drizzle ORM schema exports
 *
 * @deprecated These are compatibility re-exports that proxy the canonical
 * table definitions from `src/main/data/db/schemas/agents*.ts`.
 * TODO: Remove this directory in a follow-up PR and update all callers to
 * import directly from `@data/db/schemas/agents*`.
 */

export * from './agents.schema'
export * from './agentSkills.schema'
export * from './channels.schema'
export * from './messages.schema'
export * from './migrations.schema'
export * from './sessions.schema'
export * from './skills.schema'
export * from './tasks.schema'
