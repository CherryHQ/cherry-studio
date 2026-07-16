// EARLIEST path constants for the Electron main process.
//
// CONSTRAINTS:
//   - No business-module dependencies (no @shared / @main / business code).
//   - Only node built-ins are allowed.
//
// CONSUMERS (all main-process bootstrap services):
//   - src/main/data/bootConfig/BootConfigService.ts → uses BOOT_CONFIG_PATH

import os from 'node:os'
import path from 'node:path'

export const CHERRY_HOME_DIRNAME = '.cherrystudio'
export const CHERRY_HOME = path.join(os.homedir(), CHERRY_HOME_DIRNAME)
export const BOOT_CONFIG_PATH = path.join(CHERRY_HOME, 'boot-config.json')
