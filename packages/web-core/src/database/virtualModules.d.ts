declare module 'virtual:cherry-studio-migrations' {
  import type { MigrationMeta } from 'drizzle-orm/migrator'

  const migrations: MigrationMeta[]
  export default migrations
}
