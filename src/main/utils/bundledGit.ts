import { application } from '@application'
import { isWin } from '@main/core/platform'
import fs from 'fs'
import path from 'path'

import { bundledArtifactPlatformKey, readBundledArtifactManifest } from './bundledArtifactManifest'

export async function ensureBundledGit(): Promise<string | null> {
  if (!isWin) return null
  return application.get('BinaryManager').ensureBundledGit()
}

/**
 * Resolve the bundled MinGit materialized from the checksum-verified app payload.
 * Windows-only — other platforms have no bundled git package. Returns the path
 * to git.exe when present, or null (dev on non-Windows, or missing bundle).
 *
 * MinGit is a multi-file tree stored under the versioned Toolchain cache.
 */
export function getBundledGitPath(): string | null {
  if (!isWin) {
    return null
  }
  try {
    const manifest = readBundledArtifactManifest()
    const artifact = manifest.artifacts.mingit
    if (!artifact || artifact.kind !== 'tree') return null
    const entrypoint = artifact.entrypoints.find((candidate) => candidate.replaceAll('\\', '/').endsWith('/git.exe'))
    if (!entrypoint) return null
    const gitExe = path.join(
      application.getPath('feature.binary.mingit'),
      artifact.version,
      bundledArtifactPlatformKey(manifest.platform, manifest.arch),
      entrypoint
    )
    return fs.existsSync(gitExe) ? gitExe : null
  } catch {
    return null
  }
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
