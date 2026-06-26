import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Obsidian IPC schemas — read-only inspection of the user's local Obsidian
 * config (vault list + per-vault folder/markdown tree). Delegated to
 * `ObsidianVaultService`; no events.
 *
 * The output shapes mirror the service's `VaultInfo` / `FileInfo`. They are not
 * imported from `@main` (shared must not depend on main) — the handler's
 * delegation provides the compile-time contract check instead.
 */
export const obsidianRequestSchemas = {
  'obsidian.get_vaults': defineRoute({
    input: z.void(),
    output: z.array(z.object({ path: z.string(), name: z.string() }))
  }),
  'obsidian.get_files': defineRoute({
    input: z.object({ vaultName: z.string() }),
    output: z.array(z.object({ path: z.string(), type: z.enum(['folder', 'markdown']), name: z.string() }))
  })
}
