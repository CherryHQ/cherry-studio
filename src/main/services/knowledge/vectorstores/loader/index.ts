/**
 * Loader Registry for KnowledgeServiceV2
 *
 * Provides a registry of all content loaders and utility functions.
 */

import type { ContentLoader, KnowledgeItemType, LoaderContext, LoaderResult } from '../types'
import { DirectoryLoader } from './DirectoryLoader'
import { FileLoader } from './FileLoader'
import { NoteLoader } from './NoteLoader'
import { SitemapLoader } from './SitemapLoader'
import { UrlLoader } from './UrlLoader'

// Re-export markdown loader utilities
export type { MarkdownDocumentMetadata } from './markdownLoader'
export { loadMarkdownDocuments } from './markdownLoader'

// Re-export all loaders
export { DirectoryLoader } from './DirectoryLoader'
export { FileLoader } from './FileLoader'
export { NoteLoader } from './NoteLoader'
export { SitemapLoader } from './SitemapLoader'
export { UrlLoader } from './UrlLoader'

// Re-export types
export type { ContentLoader, LoaderContext, LoaderResult } from '../types'

/**
 * Registry of all content loaders
 */
export class LoaderRegistry {
  private loaders: Map<KnowledgeItemType, ContentLoader> = new Map()

  constructor() {
    // Register default loaders
    this.register(new FileLoader())
    this.register(new DirectoryLoader())
    this.register(new UrlLoader())
    this.register(new SitemapLoader())
    this.register(new NoteLoader())
  }

  /**
   * Register a loader for a content type
   */
  register(loader: ContentLoader): void {
    this.loaders.set(loader.type, loader)
  }

  /**
   * Get loader for a content type
   */
  get(type: KnowledgeItemType): ContentLoader | undefined {
    return this.loaders.get(type)
  }

  /**
   * Check if a loader exists for a content type
   */
  has(type: KnowledgeItemType): boolean {
    return this.loaders.has(type)
  }

  /**
   * Get all registered loader types
   */
  getTypes(): KnowledgeItemType[] {
    return Array.from(this.loaders.keys())
  }
}

/** Singleton instance of the loader registry */
export const loaderRegistry = new LoaderRegistry()

/**
 * Get loader for a content type
 */
export function getLoader(type: KnowledgeItemType): ContentLoader | undefined {
  return loaderRegistry.get(type)
}

/**
 * Load content using the appropriate loader
 */
export async function loadContent(context: LoaderContext): Promise<LoaderResult> {
  const loader = loaderRegistry.get(context.item.type as KnowledgeItemType)
  if (!loader) {
    throw new Error(`No loader registered for type: ${context.item.type}`)
  }
  return loader.load(context)
}

/**
 * Estimate workload for content loading
 */
export function estimateWorkload(context: LoaderContext): number {
  const loader = loaderRegistry.get(context.item.type as KnowledgeItemType)
  if (!loader) {
    return 0
  }
  return loader.estimateWorkload(context)
}
