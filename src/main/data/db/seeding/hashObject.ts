import { createHash } from 'crypto'

/**
 * Compute a SHA-256 hash of a JSON-serializable object.
 * Use this to auto-generate seeder version strings from seed data sources.
 *
 * Recommended for statically imported data sources <= 100KB (overhead < 0.1ms).
 * For larger data or runtime-loaded sources, prefer a data-source version or manual version string.
 *
 * Input must be plain JSON-serializable (no Map, Set, Date, undefined, Symbol, or functions).
 * Property order must be stable (guaranteed for static object literals in ES2015+).
 */
export function hashObject(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}
