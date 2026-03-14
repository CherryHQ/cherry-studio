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
 * - `local_managed`: `{base_path}/{id}{.ext}` — flat UUID-based storage
 * - `local_external`: `{base_path}/{...ancestorNames}/{name}{.ext}` — mirrors OS directory structure
 * - `system`: throws — system mounts have no physical storage
 * - `remote`: `{cache_path}/{remoteId}` — local cache path (future)
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

  switch (config.provider_type) {
    case 'local_managed':
      return path.join(config.base_path, `${node.id}${getExtSuffix(node.ext)}`)

    case 'local_external': {
      const segments = ancestorNames ?? []
      return path.join(config.base_path, ...segments, `${node.name}${getExtSuffix(node.ext)}`)
    }

    case 'system':
      throw new Error('System mount nodes have no physical storage path')

    case 'remote':
      throw new Error('Remote path resolution is not yet implemented')
  }
}
