import * as z from 'zod'
const uuid = z.uuid()
export function memoryId(clock: MemoryClock) {
  return uuid.parse(clock.createId()).toLowerCase()
}
export interface MemoryClock {
  now(): number
  /** A fresh RFC UUID for receipts and durable backup manifests. */
  createId(): string
  /** Lowercase hex SHA-256 over the exact bytes. */
  sha256(bytes: Uint8Array): string
}

export interface MemoryStorage {
  /** Monotonic membership revision, including deletion followed by recreation. */
  /** Durable proof that this batch performed the replacement. */
  applied(batchId: string, path: string): Promise<boolean>
  fileSetVersion(): Promise<string>
  list(): Promise<string[]>
  /** Reject oversized reads before allocating the result. */
  read(path: string, maxBytes: number): Promise<Uint8Array | null>
  /** Stable physical identity; canonical names also distinguish missing targets. */
  identity(path: string): Promise<string>
  /** Compare bytes and check authorization in the host's final replacement operation. */
  replace(
    path: string,
    expectedHash: string | null,
    bytes: Uint8Array | null,
    check: () => void,
    expected: {
      batchId: string
      dependencies: readonly { path: string; hash: string | null }[]
      identity: string
      paths: readonly string[]
      fileSetVersion: string
    }
  ): Promise<string>
}

export interface MemoryBackupStorage extends MemoryClock {
  list(): Promise<string[]>
  read(path: string): Promise<Uint8Array | null>
  /** Durably replace the entire manifest; a failed write preserves its previous bytes. */
  write(path: string, bytes: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
}

export function digest(clock: MemoryClock, bytes: Uint8Array): string
export function digest(clock: MemoryClock, bytes: null): null
export function digest(clock: MemoryClock, bytes: Uint8Array | null): string | null
export function digest(clock: MemoryClock, bytes: Uint8Array | null): string | null {
  return bytes === null ? null : clock.sha256(bytes)
}
