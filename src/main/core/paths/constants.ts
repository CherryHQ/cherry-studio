// EARLIEST path constants for the Electron main process.
//
// CONSTRAINTS:
//   - No business-module dependencies (no @shared / @main / business code).
//   - Only node built-ins and `electron` are allowed.
//   - Electron's `app.getPath()` is safe at this layer: it works at module
//     import time, before `app.whenReady()`. Verified by LoggerService which
//     constructs at module load and consumes LOGS_DIR through this file.
//
// CONSUMERS (all main-process bootstrap services):
//   - src/main/core/logger/LoggerService.ts         → uses LOGS_DIR
//   - src/main/data/bootConfig/BootConfigService.ts → uses BOOT_CONFIG_PATH
//   - src/main/core/paths/pathRegistry.ts           → re-exposes LOGS_DIR as 'app.logs'

import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

export const CHERRY_HOME_DIRNAME = '.cherrystudio'
export const CHERRY_HOME = path.join(os.homedir(), CHERRY_HOME_DIRNAME)
export const BOOT_CONFIG_PATH = path.join(CHERRY_HOME, 'boot-config.json')

/**
 * Logs directory. Resolves to Electron's platform-standard location:
 *   - macOS:   ~/Library/Logs/<App>/
 *   - Windows: %APPDATA%/<App>/logs
 *   - Linux:   ~/.config/<App>/logs
 *
 * Single source of truth — referenced by LoggerService directly and exposed
 * via pathRegistry as the `app.logs` key for `application.getPath()` consumers.
 */
export const LOGS_DIR = app.getPath('logs')
