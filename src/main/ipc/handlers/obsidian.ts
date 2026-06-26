import { obsidianVaultService } from '@main/services/ObsidianVaultService'
import type { obsidianRequestSchemas } from '@shared/ipc/schemas/obsidian'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Obsidian vault reads delegate to the stateless `ObsidianVaultService` singleton.
 * Both reads act on the local filesystem, not the caller window, so they ignore
 * `IpcContext`. The service methods are synchronous; the async wrappers satisfy
 * the handler contract and surface any throw as `INTERNAL`.
 */
export const obsidianHandlers: IpcHandlersFor<typeof obsidianRequestSchemas> = {
  'obsidian.get_vaults': async () => obsidianVaultService.getVaults(),
  'obsidian.get_files': async ({ vaultName }) => obsidianVaultService.getFilesByVaultName(vaultName)
}
