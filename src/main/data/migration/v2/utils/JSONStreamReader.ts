/**
 * Streaming JSON reader for processing large JSON array files
 * Uses stream-json library to avoid loading entire file into memory
 */

import { createReadStream } from 'fs'
import { parser } from 'stream-json'
import { streamArray } from 'stream-json/streamers/StreamArray'

export class JSONStreamReader {
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
    return new Promise((resolve, reject) => {
      const pipeline = createReadStream(this.filePath).pipe(parser()).pipe(streamArray())

      let batch: T[] = []
      let batchIndex = 0
      let totalCount = 0
      let isPaused = false

      const processBatch = async () => {
        if (batch.length === 0) return

        const currentBatch = batch
        batch = []
        isPaused = true
        pipeline.pause()

        try {
          await onBatch(currentBatch, batchIndex++)
          isPaused = false
          pipeline.resume()
        } catch (error) {
          reject(error)
        }
      }

      pipeline.on('data', async ({ value }: { value: T }) => {
        batch.push(value)
        totalCount++

        if (batch.length >= batchSize && !isPaused) {
          await processBatch()
        }
      })

      pipeline.on('end', async () => {
        try {
          // Process remaining items
          if (batch.length > 0) {
            await onBatch(batch, batchIndex)
          }
          resolve(totalCount)
        } catch (error) {
          reject(error)
        }
      })

      pipeline.on('error', reject)
    })
  }

  /**
   * Count total items in the JSON array without loading all data
   */
  async count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const pipeline = createReadStream(this.filePath).pipe(parser()).pipe(streamArray())

      let count = 0

      pipeline.on('data', () => {
        count++
      })

      pipeline.on('end', () => {
        resolve(count)
      })

      pipeline.on('error', reject)
    })
  }

  /**
   * Read first N items for sampling/validation
   * @param n - Number of items to read
   */
  async readSample<T>(n: number): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const pipeline = createReadStream(this.filePath).pipe(parser()).pipe(streamArray())

      const items: T[] = []

      pipeline.on('data', ({ value }: { value: T }) => {
        items.push(value)
        if (items.length >= n) {
          pipeline.destroy()
          resolve(items)
        }
      })

      pipeline.on('end', () => {
        resolve(items)
      })

      pipeline.on('error', (error) => {
        // Ignore error from destroy()
        if (items.length >= n) {
          resolve(items)
        } else {
          reject(error)
        }
      })
    })
  }
}
