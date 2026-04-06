import fs from 'node:fs'
import path from 'node:path'

import type { MountType } from '@shared/data/types/file'

/**
 * Minimal entry shape needed for path resolution
 */
export interface PathResolvableEntry {
  id: string
  name: string
  ext: string | null
  mountId: string
}

/**
 * Minimal mount shape needed for path resolution
 */
export interface PathResolvableMount {
  mountType: MountType
  basePath: string | null
}

/**
 * Get the file extension suffix (with dot) or empty string if null
 */
export function getExtSuffix(ext: string | null): string {
  return ext ? `.${ext}` : ''
}

/**
 * Resolve the physical filesystem path for a file entry.
 *
 * - `local_managed`: `{basePath}/{id}{.ext}` — flat UUID-based storage
 * - `local_external`: `{basePath}/{...ancestorNames}/{name}{.ext}` — mirrors OS directory structure
 * - `system`: throws — system mounts have no physical storage
 * - `remote`: throws — not yet implemented
 *
 * @param entry - The file entry to resolve
 * @param mount - The mount this entry belongs to
 * @param ancestorNames - Ordered list of ancestor directory names from mount root to parent (only needed for local_external)
 */
export function resolvePhysicalPath(
  entry: PathResolvableEntry,
  mount: PathResolvableMount,
  ancestorNames?: string[]
): string {
  if (!mount.basePath && (mount.mountType === 'local_managed' || mount.mountType === 'local_external')) {
    throw new Error(`Mount for entry ${entry.id} has no basePath`)
  }

  // Reject null bytes in any user-controlled path segments
  if (entry.id.includes('\0') || entry.name.includes('\0') || (entry.ext && entry.ext.includes('\0'))) {
    throw new Error('Entry id, name, or extension contains null bytes')
  }
  if (ancestorNames?.some((n) => n.includes('\0'))) {
    throw new Error('Ancestor names contain null bytes')
  }

  switch (mount.mountType) {
    case 'local_managed': {
      const resolved = path.resolve(mount.basePath!, `${entry.id}${getExtSuffix(entry.ext)}`)
      assertPathContained(resolved, mount.basePath!)
      return resolved
    }

    case 'local_external': {
      if (ancestorNames === undefined) {
        throw new Error('ancestorNames is required for local_external mount')
      }
      const resolved = path.resolve(mount.basePath!, ...ancestorNames, `${entry.name}${getExtSuffix(entry.ext)}`)
      // Resolve symlinks for local_external — user-chosen directories may contain symlinks
      try {
        const realResolved = fs.realpathSync(resolved)
        const realBase = fs.realpathSync(mount.basePath!)
        assertPathContained(realResolved, realBase)
        return realResolved
      } catch (err) {
        throw new Error(
          `Failed to resolve path for entry ${entry.id} (name="${entry.name}") ` +
            `under basePath="${mount.basePath}": ${(err as Error).message}`
        )
      }
    }

    case 'system':
      throw new Error('System mount entries have no physical storage path')

    case 'remote':
      throw new Error('Remote path resolution is not yet implemented')

    default:
      throw new Error(
        `Unknown mount type: ${(mount as unknown as Record<string, unknown>).mountType} for entry ${entry.id}`
      )
  }
}

/**
 * Assert that a resolved path stays within the base directory.
 * Prevents path traversal attacks via '..' segments.
 * For symlink protection, callers should resolve paths with fs.realpathSync() before calling.
 */
function assertPathContained(resolved: string, basePath: string): void {
  const base = path.resolve(basePath)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Path traversal detected: resolved path escapes basePath')
  }
}
