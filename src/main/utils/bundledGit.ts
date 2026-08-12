import { application } from '@application'
import { isWin } from '@main/core/platform'
import fs from 'fs'
import path from 'path'

import { toAsarUnpackedPath } from './asar'

/**
 * Resolve the bundled MinGit shipped under resources/binaries/<platform>/git.
 * Windows-only — other platforms have no bundled git package. Returns the path
 * to git.exe when present, or null (dev on non-Windows, or missing bundle).
 *
 * MinGit is a multi-file tree run in place from resources (not copied into
 * cherry.bin), so this resolves through the asar.unpacked layout in production.
 */
export function getBundledGitPath(): string | null {
  if (!isWin) {
    return null
  }
  const platformKey = `${process.platform}-${process.arch}`
  const gitExe = toAsarUnpackedPath(
    path.join(application.getPath('app.root.resources.binaries'), platformKey, 'git', 'cmd', 'git.exe')
  )
  return fs.existsSync(gitExe) ? gitExe : null
}

/**
 * Directory holding the bundled MinGit `git.exe` (its `cmd/` dir), or null when
 * the bundle is absent. Appended to the tail of a spawned process's PATH (see
 * shellEnv) so agents and tools that shell out to a bare `git` still resolve one
 * when the user has no system git — kept last so system/mise/PATH git win.
 */
export function getBundledGitDir(): string | null {
  const gitExe = getBundledGitPath()
  return gitExe ? path.dirname(gitExe) : null
}
