import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path to the production Drizzle migrations folder.
 *
 * Resolved relative to this module's own location so it works under Vitest's
 * `transform`-based module runner — hardcoded `process.cwd()` is unreliable
 * when tests run from different working directories.
 */
export function resolveMigrationsPath(): string {
  const thisFile = fileURLToPath(import.meta.url)
  const thisDir = dirname(thisFile)
  // tests/helpers/db/internal/migrationsPath.ts → repo root is 4 levels up
  return resolve(thisDir, '../../../../migrations/sqlite-drizzle')
}
