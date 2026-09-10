import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('LaunchScript')

// Scripts awaiting the 60s cleanup; the exit handler drains whatever is left.
const pendingCleanups = new Set<string>()
let exitCleanupRegistered = false

/**
 * Write a terminal-launch script (macOS `.sh` / Windows `.bat`) into the CLI
 * temp dir with a short-lived lifecycle: 0600, deleted after 60s, and drained
 * on process exit as a fallback. Keeping the terminal command at `sh '<path>'`
 * avoids the AppleEvent/argv length limits that truncated inline commands.
 *
 * @param cliTool - CLI tool id, used in the file name only
 * @param body - Full script content; the caller owns shell/bat semantics
 * @param ext - Script flavor, also the file extension
 * @returns Absolute path of the written script
 */
export function writeLaunchScript(cliTool: string, body: string, ext: '.sh' | '.bat'): string {
  const tempDir = application.getPath('feature.cli.temp')
  const scriptPath = path.join(tempDir, `launch_${cliTool}_${Date.now()}${ext}`)

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  try {
    fs.writeFileSync(scriptPath, body, 'utf8')
    // The body may carry env layout details; restrict reads to the owner.
    fs.chmodSync(scriptPath, 0o600)
    logger.info(`Created launch script: ${scriptPath}`)
  } catch (error) {
    logger.error(`Failed to create launch script: ${error}`)
    throw new Error(`Failed to create launch script: ${error}`)
  }

  registerCleanup(scriptPath)
  return scriptPath
}

function registerCleanup(scriptPath: string): void {
  pendingCleanups.add(scriptPath)

  if (!exitCleanupRegistered) {
    process.once('exit', () => {
      for (const pending of pendingCleanups) {
        removeScript(pending, 'on exit')
      }
      pendingCleanups.clear()
    })
    exitCleanupRegistered = true
  }

  setTimeout(() => {
    removeScript(scriptPath, '')
    pendingCleanups.delete(scriptPath)
  }, 60 * 1000)
}

function removeScript(scriptPath: string, phase: string): void {
  try {
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath)
      logger.debug(`Cleaned up launch script${phase}: ${scriptPath}`)
    }
  } catch (error) {
    // Cleanup is best-effort; a stale 0600 file in temp must never fail a launch.
    logger.warn(`Failed to cleanup launch script${phase}: ${error}`)
  }
}
