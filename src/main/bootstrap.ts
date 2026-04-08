/**
 * @deprecated Superseded by `src/main/core/preboot/` — DO NOT IMPORT.
 *
 * ⚠️ V2 STATUS: This file is no longer imported by `src/main/index.ts`.
 * Its responsibilities have been taken over by the single
 * `resolveUserDataLocation()` function in
 * `src/main/core/preboot/userDataLocation.ts`:
 *   - initAppDataDir()                  → resolveUserDataLocation() (Step 2)
 *   - copyOccupiedDirsInMainProcess()   → resolveUserDataLocation() (Step 1,
 *                                          via executePendingRelocation)
 *
 * Two fundamental differences from v1 — the v2 design is not a
 * port-for-port rewrite, it is a different architecture:
 *
 * 1. **No v1 config.json fallback.** resolveUserDataLocation() reads from
 *    BootConfig only. v1→v2 migration is handled by the migration system
 *    (via the `configfile` source in BootConfigMigrator), not by preboot.
 *
 * 2. **No argv protocol, no "occupied dirs" concept.** v1 used a
 *    two-phase copy to work around Windows file locks:
 *
 *      Phase A (renderer running): renderer copies the bulk of userData
 *      *excluding* `occupiedDirs` (logs / Network / Partitions/webview/
 *      Network — locked by the running winston + Chromium) and triggers
 *      relaunch with argv `--new-data-path=<dest>`.
 *
 *      Phase B (this file, main process on next startup): reads the argv,
 *      copies `occupiedDirs` from the current userData to the new path
 *      during the narrow window when the old process has exited but the
 *      renderer has not yet started.
 *
 *    v2 abandons both phases. The entire userData tree is copied in a
 *    single synchronous step inside preboot, *after* the previous process
 *    has fully exited and before any new file handle is opened — nothing
 *    is locked, so the "occupied" vs "non-occupied" distinction is
 *    meaningless. The `occupiedDirs` constant in
 *    `packages/shared/config/constant.ts` is also deprecated and will be
 *    deleted alongside this file in the cleanup PR.
 *
 *    Communication between the IPC handler and the next-startup copy uses
 *    BootConfig's `temp.user_data_relocation` field (a structured request
 *    with `status: 'pending' | 'failed'`) instead of an argv flag. This
 *    also lets a future renderer UI read the `failed` state and offer a
 *    recovery flow (retry / abandon / investigate).
 *
 * The file is kept on disk during the v2 transition as a reference for
 * the follow-up cleanup PR, which will also migrate the
 * `App_SetAppDataPath` IPC handler and the renderer's migration modal in
 * `BasicDataSettings.tsx` to the new BootConfig-driven protocol.
 *
 * STOP: Do not re-add `import './bootstrap'` to index.ts. Do not extend
 * this file. Bug fixes go into `core/preboot/userDataLocation.ts` instead.
 */

import { occupiedDirs } from '@shared/config/constant'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import { initAppDataDir } from './utils/init'

app.isPackaged && initAppDataDir()

// 在主进程中复制 appData 中某些一直被占用的文件
// 在renderer进程还没有启动时，主进程可以复制这些文件到新的appData中
function copyOccupiedDirsInMainProcess() {
  const newAppDataPath = process.argv
    .slice(1)
    .find((arg) => arg.startsWith('--new-data-path='))
    ?.split('--new-data-path=')[1]
  if (!newAppDataPath) {
    return
  }

  if (process.platform === 'win32') {
    const appDataPath = app.getPath('userData')
    occupiedDirs.forEach((dir) => {
      const dirPath = path.join(appDataPath, dir)
      const newDirPath = path.join(newAppDataPath, dir)
      if (fs.existsSync(dirPath)) {
        fs.cpSync(dirPath, newDirPath, { recursive: true })
      }
    })
  }
}

copyOccupiedDirsInMainProcess()
