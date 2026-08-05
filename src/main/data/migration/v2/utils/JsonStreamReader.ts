/**
 * Streaming JSON reader for processing large JSON array files
 * Uses stream-json library to avoid loading entire file into memory
 */

import { createReadStream } from 'fs'
import { parser } from 'stream-json'
import { streamArray } from 'stream-json/streamers/StreamArray'

export class JsonStreamReader {
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /**
   * Read JSON array in streaming mode with batch processing
   * @param batchSize - Number of items per batch
   * @param onBatch - Callback for each batch
   * @returns Total number of items processed
   */
  async readInBatches<T>(
    batchSize: number,
    onBatch: (items: T[], batchIndex: number) => Promise<void>
  ): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error('batchSize must be a positive integer')

    const pipeline = createReadStream(this.filePath).pipe(parser()).pipe(streamArray())
    let batch: T[] = []
    let batchIndex = 0
    let totalCount = 0

    // Async iteration supplies real backpressure: the parser cannot emit the
    // next batch while the callback is still inserting the current one.
    for await (const { value } of pipeline as AsyncIterable<{ value: T }>) {
      batch.push(value)
      totalCount++
      if (batch.length < batchSize) continue

      const currentBatch = batch
      batch = []
      await onBatch(currentBatch, batchIndex++)
    }

    if (batch.length > 0) await onBatch(batch, batchIndex)
    return totalCount
  }

  /**
   * Count total items in the JSON array without loading all data
   */
  async count(): Promise<number> {
    const pipeline = createReadStream(this.filePath).pipe(parser()).pipe(streamArray())
    let count = 0
    for await (const entry of pipeline) {
      void entry
      count++
    }
    return count
  }

  /**
   * Read first N items for sampling/validation
   * @param n - Number of items to read
   */
  async readSample<T>(n: number): Promise<T[]> {
    if (!Number.isInteger(n) || n < 0) throw new Error('sample size must be a non-negative integer')
    if (n === 0) return []

    const pipeline = createReadStream(this.filePath).pipe(parser()).pipe(streamArray())
    const items: T[] = []
    for await (const { value } of pipeline as AsyncIterable<{ value: T }>) {
      items.push(value)
      if (items.length >= n) break
    }
    return items
  }
}
