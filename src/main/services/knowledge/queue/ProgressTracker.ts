/**
 * ProgressTracker - Tracks progress of knowledge processing tasks with TTL-based expiration
 *
 * Provides progress tracking with automatic cleanup of stale entries.
 */

export class ProgressTracker {
  private entries = new Map<string, { progress: number; updatedAt: number }>()
  private cleanupCounter = 0
  private static readonly CLEANUP_INTERVAL = 100 // Run cleanup every N set() calls

  constructor(private readonly ttlMs: number) {}

  /**
   * Get the progress for an item
   * @param itemId The item identifier
   * @returns The progress value (0-100) or undefined if not found/expired
   */
  get(itemId: string): number | undefined {
    const entry = this.entries.get(itemId)
    if (!entry) {
      return undefined
    }

    if (Date.now() - entry.updatedAt > this.ttlMs) {
      this.entries.delete(itemId)
      return undefined
    }

    return entry.progress
  }

  /**
   * Set the progress for an item
   * @param itemId The item identifier
   * @param progress The progress value (0-100)
   */
  set(itemId: string, progress: number): void {
    this.entries.set(itemId, { progress, updatedAt: Date.now() })

    // Periodically clean up expired entries to prevent memory leaks
    this.cleanupCounter += 1
    if (this.cleanupCounter >= ProgressTracker.CLEANUP_INTERVAL) {
      this.cleanupCounter = 0
      this.cleanupExpired()
    }
  }

  /**
   * Delete the progress entry for an item
   * @param itemId The item identifier
   */
  delete(itemId: string): void {
    this.entries.delete(itemId)
  }

  private cleanupExpired(): void {
    const now = Date.now()
    for (const [itemId, entry] of this.entries) {
      if (now - entry.updatedAt > this.ttlMs) {
        this.entries.delete(itemId)
      }
    }
  }
}
