/**
 * Knowledge module job type registrations.
 *
 * Co-locates the `declare module` extensions for every JobRegistry entry the
 * knowledge module owns. Handler files import this module purely for the
 * ambient type-merge side effect, which guarantees that any handler in this
 * directory can safely call `jobManager.enqueue('knowledge.*')` even when it
 * does not directly reference the sibling handler.
 */

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'knowledge.prepare-root': {
      baseId: string
      itemId: string
      itemType: 'directory' | 'sitemap'
    }
    'knowledge.index-leaf': {
      baseId: string
      itemId: string
      parentJobId: string | null
    }
  }
}

export type KnowledgePrepareRootPayload = {
  baseId: string
  itemId: string
  itemType: 'directory' | 'sitemap'
}

export type KnowledgeIndexLeafPayload = {
  baseId: string
  itemId: string
  parentJobId: string | null
}
