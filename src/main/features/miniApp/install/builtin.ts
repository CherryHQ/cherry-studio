/**
 * Builtin mini apps are NOT installed at boot. They appear in the launcher as a
 * separate, not-yet-installed section and install on first open.
 *
 * That is a product decision with three architectural payoffs: no boot-time
 * reconciliation pass, no "installed but never consented" state to invent (consent
 * happens when the user opens it, which is the same moment a user-installed package
 * gets its consent dialog), and no userData spent on apps nobody opened.
 *
 * Which is why there is no `listBuiltinMiniApps` here: `BUILTIN_MINI_APPS` lives in
 * `@shared`, the launcher is its only reader, and main filtering a list main never
 * reads would be an export with no caller.
 */
import fs from 'node:fs'

import type { MiniAppManifest } from '@shared/types/miniAppManifest'

import { miniAppBuiltinPath } from '../paths'
import { bestEffortCleanup } from './cleanup'
import { copyTreeToStaging, createStagingDir, hashTree } from './installer'

/**
 * STAGE, do not install.
 *
 * A one-call `installBuiltinMiniApp` would grant everything the manifest declares without
 * the user having seen the list — the hole the preview/confirm split exists to
 * close. Shipping with Cherry buys trust in the AUTHOR, not consent for the
 * permissions, and a builtin app asks for `file` and `ai` like any other.
 *
 * Returns the staged tree rather than installing it: builtin shares the ONE install
 * protocol and ledger — `confirmPendingInstall` dispatches on payload kind,
 * and its `builtin` case is where this function is consumed, at confirm time.
 */
export async function stageBuiltinMiniApp(
  appId: string,
  builtinRoot?: string
): Promise<{ stagingDir: string; contentHash: string; manifest: MiniAppManifest }> {
  const root = builtinRoot ?? miniAppBuiltinPath(appId)
  const stagingDir = await createStagingDir()
  try {
    const manifest = await copyTreeToStaging(root, stagingDir)
    if (manifest.id !== appId) throw new Error(`Builtin tree for ${appId} declares id ${manifest.id}`)
    return { stagingDir, contentHash: await hashTree(stagingDir), manifest }
  } catch (error) {
    await bestEffortCleanup('builtin staging', () => fs.promises.rm(stagingDir, { recursive: true, force: true }))
    throw error
  }
}
