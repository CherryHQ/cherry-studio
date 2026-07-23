/**
 * VFS offloading: persists oversized content through a storage adapter and
 * replaces it with a head/tail truncation marker carrying a retrieval handle.
 *
 * Vendored from @context-chef/core 3.8.0 (MIT, same author), trimmed to the
 * async offload path Cherry Studio uses (no sync path, no read-back, no
 * LRU/cleanup — the main process owns storage lifecycle via VfsBlobService).
 *
 * Hashing uses Web Crypto (`globalThis.crypto.subtle`) so this module stays
 * platform-neutral; filenames are byte-identical to the upstream node:crypto
 * implementation (sha256 hex, first 16 chars).
 */
import { ContextPrompts } from './prompts'

export interface VFSStorageAdapter {
  write(filename: string, content: string): void | Promise<void>
  read(filename: string): string | null | Promise<string | null>
  /**
   * Optional. Lets the Offloader skip redundant writes when a
   * content-addressed file already exists. Adapters that can't answer
   * cheaply may leave this unset — the Offloader then overwrites, which
   * is harmless (same filename ⇒ same content).
   *
   * Contract: only return true for FULLY persisted content. With
   * content-addressed names the Offloader treats existence as proof the
   * bytes are complete and skips the write. Make writes atomic.
   */
  exists?(filename: string): boolean | Promise<boolean>
  /** Optional. Returns all stored filenames. */
  list?(): string[] | Promise<string[]>
  /** Optional. Must be idempotent (no-op on missing files). */
  delete?(filename: string): void | Promise<void>
  /**
   * Optional. When implemented, the Offloader exposes the underlying physical
   * path in the truncation marker, letting the model retrieve the original
   * content with its existing file-read tool — no custom URI-aware tool needed.
   * Adapters that don't map to a filesystem (DB, in-memory) should leave this
   * unset; the marker then falls back to the URI alone.
   */
  getPhysicalPath?(filename: string): string | null | Promise<string | null>
}

const URI_SCHEME = 'context://vfs/'

export interface VFSResult {
  isOffloaded: boolean
  content: string
  uri?: string
}

export interface OffloadOptions {
  /** Allows overriding the instance threshold for a specific call */
  threshold?: number
  /** Number of characters to preserve from the head of the content (default: 0) */
  headChars?: number
  /** Number of characters to preserve from the tail of the content (default: 2000) */
  tailChars?: number
}

export interface OffloaderConfig {
  /** Maximum length of content before it gets offloaded (e.g. 5000 characters) */
  threshold: number
  /** Storage adapter that persists offloaded content. */
  adapter: VFSStorageAdapter
}

export class Offloader {
  private readonly threshold: number
  private readonly adapter: VFSStorageAdapter

  constructor(config: OffloaderConfig) {
    this.threshold = config.threshold
    this.adapter = config.adapter
  }

  /**
   * Snaps a character index to the nearest line boundary.
   * For head: snaps backward to include the last complete line.
   * For tail: snaps forward to start at the beginning of a line.
   */
  private _snapToLineBoundary(content: string, charIndex: number, direction: 'head' | 'tail'): number {
    if (charIndex <= 0) return 0
    if (charIndex >= content.length) return content.length

    if (direction === 'head') {
      const lastNewline = content.lastIndexOf('\n', charIndex)
      return lastNewline === -1 ? charIndex : lastNewline + 1
    }
    const nextNewline = content.indexOf('\n', charIndex)
    return nextNewline === -1 ? charIndex : nextNewline + 1
  }

  private async _generateFilename(content: string): Promise<{ filename: string; uri: string }> {
    // Content-addressed: identical content always maps to the same file, so
    // re-offloading in an agent loop is idempotent and the truncation marker
    // (URI + physical path) is byte-stable — provider prefix caches survive.
    // 16 hex chars (64 bits) because the hash alone is the identity.
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 16)
    const filename = `vfs_${hash}.txt`
    const uri = `${URI_SCHEME}${filename}`
    return { filename, uri }
  }

  private _buildTruncatedMarker(
    content: string,
    uri: string,
    headChars: number,
    tailChars: number,
    physicalPath: string | null
  ): string {
    const totalLines = content.split('\n').length
    const totalChars = content.length

    const headEnd = headChars > 0 ? this._snapToLineBoundary(content, headChars, 'head') : 0
    const tailStart =
      tailChars > 0 ? this._snapToLineBoundary(content, content.length - tailChars, 'tail') : content.length

    const headStr = headEnd > 0 ? content.slice(0, headEnd) : ''
    const tailStr = tailStart < content.length ? content.slice(tailStart) : ''

    return ContextPrompts.getVFSOffloadReminder(uri, totalLines, totalChars, headStr, tailStr, physicalPath)
  }

  private async _resolvePhysicalPath(filename: string): Promise<string | null> {
    if (!this.adapter.getPhysicalPath) return null
    return await this.adapter.getPhysicalPath(filename)
  }

  /**
   * If content exceeds the threshold, writes full content to the adapter and
   * returns a truncated marker string with a pointer URI. Supports both
   * synchronous and asynchronous adapters.
   */
  public async offloadAsync(content: string, options?: OffloadOptions): Promise<VFSResult> {
    const activeThreshold = options?.threshold ?? this.threshold
    const headChars = options?.headChars ?? 0
    const tailChars = options?.tailChars ?? 2000

    if (content.length <= activeThreshold) {
      return { isOffloaded: false, content }
    }

    if (headChars + tailChars >= content.length) {
      return { isOffloaded: false, content }
    }

    const { filename, uri } = await this._generateFilename(content)
    const physicalPath = await this._resolvePhysicalPath(filename)
    const truncated = this._buildTruncatedMarker(content, uri, headChars, tailChars, physicalPath)

    if (this.adapter.exists && (await this.adapter.exists(filename))) {
      return { isOffloaded: true, content: truncated, uri }
    }

    await this.adapter.write(filename, content)

    return {
      isOffloaded: true,
      content: truncated,
      uri
    }
  }
}
