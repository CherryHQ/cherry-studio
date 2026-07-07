/**
 * Shared types for the v2 userData relocation flow.
 *
 * Relocation is driven entirely from preboot: the renderer only ever writes
 * a `pending` request to `temp.user_data_relocation` (via
 * `app.set_user_data_path`) and relaunches. On the next launch the
 * preboot relocation gate (`core/preboot/relocation/relocationGate.ts`)
 * opens a dedicated window, performs the copy (if requested), commits the
 * new path to BootConfig, and relaunches again. These channels are the
 * main↔renderer contract for that window only.
 */

export const RelocationIpcChannels = {
  /** Renderer queries the current relocation state on mount. */
  GetProgress: 'relocation:get-progress',
  /** Main pushes progress updates to the relocation window. */
  Progress: 'relocation:progress',
  /** Renderer asks main to relaunch after a failed relocation. */
  Restart: 'relocation:restart'
} as const

export type RelocationStage = 'preparing' | 'copying' | 'committing' | 'failed'

export interface RelocationProgress {
  stage: RelocationStage
  /** Current userData being relocated from. */
  from: string
  /** Target userData being relocated to. */
  to: string
  /** Whether the from→to tree is being copied (false = location switch only). */
  copy: boolean
  /** Bytes copied so far; only meaningful when stage === 'copying'. */
  bytesCopied: number
  /** Total bytes to copy (pre-computed); only meaningful when stage === 'copying'. */
  bytesTotal: number
  /** Present only when stage === 'failed'. Not persisted to BootConfig. */
  error?: string
}
