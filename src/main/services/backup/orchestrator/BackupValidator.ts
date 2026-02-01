/**
 * BackupValidator
 * Implements checksum computation and validation using xxhash-wasm
 */

import xxhash from 'xxhash-wasm'

// Type for the xxhash-wasm module - relaxed to match actual API
type XxhashAPI = {
  h32: (input: string | Uint8Array, seed?: number) => number
  h64: (input: string | Uint8Array, seed?: bigint) => bigint
  h32ToString: (hash: number) => string
  h64ToString: (hash: bigint) => string
  h32Raw: (input: Uint8Array, seed?: number) => number
  h64Raw: (input: Uint8Array, seed?: bigint) => bigint
  create32: () => {
    init: (seed?: number) => void
    update: (input: Uint8Array) => void
    digest: () => number
  }
  create64: () => {
    init: (seed?: bigint) => void
    update: (input: Uint8Array) => void
    digest: () => bigint
  }
}

// xxhash WASM module singleton
let xxhashModule: XxhashAPI | null = null

async function getXxhashModule(): Promise<XxhashAPI> {
  if (!xxhashModule) {
    xxhashModule = (await xxhash()) as unknown as XxhashAPI
  }
  return xxhashModule
}

/**
 * Options for hash computation
 */
interface HashOptions {
  /** Output format: "hex" or "base64" */
  outputFormat?: 'hex' | 'base64'
  /** Use xxh64 (faster) or xxh3 (more secure) */
  algorithm?: 'xxh64' | 'xxh3'
}

/**
 * Default hash options
 */
const DEFAULT_HASH_OPTIONS: Required<HashOptions> = {
  outputFormat: 'hex',
  algorithm: 'xxh64'
}

/**
 * Computes hash of data from a readable stream
 * Uses chunked processing for memory efficiency
 * @param stream - Readable stream of data
 * @param options - Hash options
 * @returns Promise resolving to hash string
 */
export async function computeStreamHash(stream: NodeJS.ReadableStream, options: HashOptions = {}): Promise<string> {
  const { outputFormat, algorithm } = { ...DEFAULT_HASH_OPTIONS, ...options }
  const hasher = await getXxhashModule()

  // Create a hash function based on algorithm
  const hashFunc = algorithm === 'xxh64' ? hasher.create64() : hasher.create32()

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener('data', onData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
    }

    const onData = (chunk: Buffer) => {
      hashFunc.update(chunk)
    }

    const onEnd = () => {
      try {
        const result = hashFunc.digest()
        cleanup()
        resolve(formatHashFromNumber(result, outputFormat))
      } catch (error) {
        reject(error)
      }
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    stream.on('data', onData as (chunk: unknown) => void)
    stream.on('end', onEnd)
    stream.on('error', onError)
  })
}

/**
 * Computes hash of a file
 * @param filePath - Path to the file
 * @param options - Hash options
 * @returns Promise resolving to hash string
 */
export async function computeFileHash(filePath: string, options: HashOptions = {}): Promise<string> {
  const { createReadStream } = await import('node:fs')
  const stream = createReadStream(filePath)
  return computeStreamHash(stream, options)
}

/**
 * Computes hash of a buffer
 * @param buffer - Data buffer
 * @param options - Hash options
 * @returns Promise resolving to hash string
 */
export async function computeBufferHash(buffer: Uint8Array, options: HashOptions = {}): Promise<string> {
  const { outputFormat, algorithm } = { ...DEFAULT_HASH_OPTIONS, ...options }
  const hasher = await getXxhashModule()

  let result: bigint | number
  if (algorithm === 'xxh64') {
    result = hasher.h64(buffer)
  } else {
    result = hasher.h32(buffer)
  }

  return formatHashFromNumber(result, outputFormat)
}

/**
 * Formats hash to specified format
 * @param hash - Hash result from xxhash
 * @param format - Output format
 * @returns Formatted hash string
 */
function formatHashFromNumber(hash: bigint | number, format: 'hex' | 'base64'): string {
  const bigintHash = typeof hash === 'bigint' ? hash : BigInt(hash)

  if (format === 'hex') {
    return bigintHash.toString(16).padStart(16, '0')
  }
  // base64
  const bytes = new Uint8Array(8)
  let value = bigintHash
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return Buffer.from(bytes).toString('base64')
}

/**
 * Validates a checksum against data
 * @param data - Data to validate
 * @param expectedChecksum - Expected checksum (hex or base64)
 * @param options - Hash options (should match how checksum was computed)
 * @returns Promise resolving to true if valid, false if not
 */
export async function validateChecksum(
  data: Uint8Array,
  expectedChecksum: string,
  options: HashOptions = {}
): Promise<boolean> {
  const actualChecksum = await computeBufferHash(data, options)
  // Compare case-insensitive for hex
  if (options.outputFormat !== 'base64') {
    return actualChecksum.toLowerCase() === expectedChecksum.toLowerCase()
  }
  return actualChecksum === expectedChecksum
}

/**
 * Validates a file's checksum
 * @param filePath - Path to the file
 * @param expectedChecksum - Expected checksum
 * @param options - Hash options
 * @returns Promise resolving to true if valid
 */
export async function validateFileChecksum(
  filePath: string,
  expectedChecksum: string,
  options: HashOptions = {}
): Promise<boolean> {
  const { readFile } = await import('node:fs/promises')
  const data = await readFile(filePath)
  return validateChecksum(data, expectedChecksum, options)
}

/**
 * Computes multiple checksums in parallel
 * @param sources - Array of { name, data } or { name, path }
 * @param options - Hash options
 * @returns Promise resolving to record of name -> checksum
 */
export async function computeChecksums(
  sources: Array<{ name: string; data?: Uint8Array; path?: string }>,
  options: HashOptions = {}
): Promise<Record<string, string>> {
  const results: Record<string, string> = {}

  await Promise.all(
    sources.map(async (source) => {
      if (source.data) {
        results[source.name] = await computeBufferHash(source.data, options)
      } else if (source.path) {
        results[source.name] = await computeFileHash(source.path, options)
      }
    })
  )

  return results
}

/**
 * Progress callback for long-running hash operations
 */
interface HashProgressCallback {
  (progress: { bytesProcessed: bigint; totalBytes: bigint; percent: number }): void
}

/**
 * Computes hash of a large file with progress tracking
 * @param filePath - Path to the file
 * @param onProgress - Progress callback
 * @param options - Hash options
 * @returns Promise resolving to hash string
 */
export async function computeFileHashWithProgress(
  filePath: string,
  onProgress: HashProgressCallback,
  options: HashOptions = {}
): Promise<string> {
  const stat = (await import('node:fs/promises')).stat
  const createReadStream = (await import('node:fs')).createReadStream
  const fileStat = (await stat(filePath)) as { size: number }
  const hasher = await getXxhashModule()
  const { outputFormat, algorithm } = { ...DEFAULT_HASH_OPTIONS, ...options }
  const hashFunc = algorithm === 'xxh64' ? hasher.create64() : hasher.create32()

  const stream = createReadStream(filePath)
  let bytesProcessed = 0n
  const totalBytes = BigInt(fileStat.size)

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: unknown) => {
      if (chunk instanceof Buffer) {
        hashFunc.update(chunk)
        bytesProcessed += BigInt(chunk.length)

        if (onProgress) {
          onProgress({
            bytesProcessed,
            totalBytes,
            percent: Number((bytesProcessed * 100n) / totalBytes)
          })
        }
      }
    })

    stream.on('end', () => {
      const result = hashFunc.digest()
      resolve(formatHashFromNumber(result, outputFormat))
    })

    stream.on('error', reject)
  })
}
