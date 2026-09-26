/**
 * Disk-space health of the volume that hosts Cherry Studio's user-data directory.
 *
 * Produced by the main-process StorageMonitorService and published through the
 * shared cache so the renderer can surface a low-disk warning. `low` means the free
 * space dropped below the warning threshold (data loss becomes likely).
 */
export type StorageHealthLevel = 'ok' | 'low'

export interface StorageHealth {
  level: StorageHealthLevel
  /** Free bytes available to the (non-privileged) process on the user-data volume. */
  freeBytes: number
  /** Total bytes of the user-data volume. */
  totalBytes: number
  /** When this snapshot was taken (epoch ms). */
  checkedAt: number
}
