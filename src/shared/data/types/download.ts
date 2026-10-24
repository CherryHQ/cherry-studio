/**
 * Lifecycle of one download task.
 *
 * `merging` is kept separate from `downloading` for the final fsync + rename
 * step: a crash there must resume as a completion check, not as more range
 * requests. `cancelled` is terminal; `failed` is retryable.
 */
export const DOWNLOAD_STATES = [
  'queued',
  'probing',
  'downloading',
  'paused',
  'merging',
  'completed',
  'failed',
  'cancelled'
] as const

export type DownloadState = (typeof DOWNLOAD_STATES)[number]

export const TERMINAL_DOWNLOAD_STATES: readonly DownloadState[] = ['completed', 'cancelled']

export type DownloadSource = 'browser' | 'agent' | 'manual'
