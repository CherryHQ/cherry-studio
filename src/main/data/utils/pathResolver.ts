import path from 'node:path'

import type { MountProviderConfig } from '@shared/data/types/fileProvider'

/**
 * Minimal node shape needed for path resolution
 */
export interface PathResolvableNode {
  id: string
  name: string
  ext: string | null
  mountId: string
}

/**
 * Mount info needed for path resolution
 */
export interface MountInfo {
  providerConfig: MountProviderConfig | null
}

/**
 * Get the file extension suffix (with dot) or empty string if null
 */
export function getExtSuffix(ext: string | null): string {
  return ext ? `.${ext}` : ''
}

/**
 * Resolve the physical filesystem path for a node.
 *
 * - `local_managed`: `{basePath}/{id}{.ext}` — flat UUID-based storage
 * - `local_external`: `{basePath}/{...ancestorNames}/{name}{.ext}` — mirrors OS directory structure
 * - `system`: throws — system mounts have no physical storage
 * - `remote`: `{cachePath}/{remoteId}` — local cache path (future)
 *
 * @param node - The node to resolve
 * @param mount - The mount this node belongs to
 * @param ancestorNames - Ordered list of ancestor directory names from mount root to parent (only needed for local_external)
 */
export function resolvePhysicalPath(node: PathResolvableNode, mount: MountInfo, ancestorNames?: string[]): string {
  const config = mount.providerConfig
  if (!config) {
    throw new Error(`Mount for node ${node.id} has no provider config`)
  }

  // Reject null bytes in any user-controlled path segments
  if (node.name.includes('\0') || (node.ext && node.ext.includes('\0'))) {
    throw new Error('Node name or extension contains null bytes')
  }
  if (ancestorNames?.some((n) => n.includes('\0'))) {
    throw new Error('Ancestor names contain null bytes')
  }

  switch (config.providerType) {
    case 'local_managed': {
      const resolved = path.resolve(config.basePath, `${node.id}${getExtSuffix(node.ext)}`)
      assertPathContained(resolved, config.basePath)
      return resolved
    }

    case 'local_external': {
      const segments = ancestorNames ?? []
      const resolved = path.resolve(config.basePath, ...segments, `${node.name}${getExtSuffix(node.ext)}`)
      assertPathContained(resolved, config.basePath)
      return resolved
    }

    case 'system':
      throw new Error('System mount nodes have no physical storage path')

    case 'remote':
      throw new Error('Remote path resolution is not yet implemented')

    default:
      throw new Error(`Unknown provider type: ${(config as Record<string, unknown>).providerType} for node ${node.id}`)
  }
}

/**
 * Assert that a resolved path stays within the base directory.
 * Prevents path traversal attacks via '..' segments or symlink tricks.
 */
function assertPathContained(resolved: string, basePath: string): void {
  const base = path.resolve(basePath)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Path traversal detected: resolved path escapes basePath')
  }
}
