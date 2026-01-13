/**
 * Reader Registry for KnowledgeServiceV2
 *
 * Provides a registry of all content readers and utility functions.
 */

import type { ContentReader, KnowledgeItemType, ReaderContext, ReaderResult } from '../types'
import { DirectoryReader } from './DirectoryReader'
import { FileReader } from './FileReader'
import { NoteReader } from './NoteReader'
import { SitemapReader } from './SitemapReader'
import { UrlReader } from './UrlReader'

// Re-export all readers
export { DirectoryReader } from './DirectoryReader'
export { FileReader } from './FileReader'
export { NoteReader } from './NoteReader'
export { SitemapReader } from './SitemapReader'
export { UrlReader } from './UrlReader'

// Re-export types
export type { ContentReader, ReaderContext, ReaderResult } from '../types'

/**
 * Registry of all content readers
 */
export class ReaderRegistry {
  private readers: Map<KnowledgeItemType, ContentReader> = new Map()

  constructor() {
    // Register default readers
    this.register(new FileReader())
    this.register(new DirectoryReader())
    this.register(new UrlReader())
    this.register(new SitemapReader())
    this.register(new NoteReader())
  }

  /**
   * Register a reader for a content type
   */
  register(reader: ContentReader): void {
    this.readers.set(reader.type, reader)
  }

  /**
   * Get reader for a content type
   */
  get(type: KnowledgeItemType): ContentReader | undefined {
    return this.readers.get(type)
  }

  /**
   * Check if a reader exists for a content type
   */
  has(type: KnowledgeItemType): boolean {
    return this.readers.has(type)
  }

  /**
   * Get all registered reader types
   */
  getTypes(): KnowledgeItemType[] {
    return Array.from(this.readers.keys())
  }
}

/** Singleton instance of the reader registry */
export const readerRegistry = new ReaderRegistry()

/**
 * Get reader for a content type
 */
export function getReader(type: KnowledgeItemType): ContentReader | undefined {
  return readerRegistry.get(type)
}

/**
 * Read content using the appropriate reader
 */
export async function readContent(context: ReaderContext): Promise<ReaderResult> {
  const reader = readerRegistry.get(context.item.type as KnowledgeItemType)
  if (!reader) {
    throw new Error(`No reader registered for type: ${context.item.type}`)
  }
  return reader.read(context)
}
