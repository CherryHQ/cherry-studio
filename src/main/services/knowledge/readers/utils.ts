import type { BaseNode, Metadata } from '@vectorstores/core'

/**
 * Apply standard metadata (external_id, source, type) to all nodes from a reader.
 */
export function applyNodeMetadata(
  nodes: BaseNode<Metadata>[],
  meta: { externalId: string; source?: string; type?: string }
): void {
  for (const node of nodes) {
    node.metadata = {
      ...node.metadata,
      external_id: meta.externalId,
      ...(meta.source !== undefined && { source: meta.source }),
      ...(meta.type !== undefined && { type: meta.type })
    }
  }
}
