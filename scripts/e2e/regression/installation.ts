import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { normalizeRunnerArch, selectReleaseAsset, sha256File } from './artifacts'
import type { RunPaths } from './paths'
import { isPathInside } from './paths'
import type { Platform } from './types'

export interface InstallationRecord {
  artifactName: string
  artifactPath: string
  artifactSha256: string
  executablePath: string
  installedPath: string
}

export async function prepareRelease(
  paths: RunPaths,
  options: { repository: string; ref: string; platform: Platform; arch: string }
): Promise<InstallationRecord> {
  const { repository, ref, platform } = options
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GitHub repository slug')
  const arch = normalizeRunnerArch(options.arch)
  const release = JSON.parse(
    execFileSync('gh', ['api', `repos/${repository}/releases/tags/${encodeURIComponent(ref)}`], {
      encoding: 'utf8',
      timeout: 60_000
    })
  ) as { assets: Array<{ name: string }> }
  const name = selectReleaseAsset(
    release.assets.map((asset) => asset.name),
    platform,
    arch
  )
  execFileSync(
    'gh',
    ['release', 'download', ref, '--repo', repository, '--pattern', name, '--dir', paths.artifacts, '--clobber'],
    {
      stdio: 'inherit',
      timeout: 300_000
    }
  )
  const artifactPath = join(paths.artifacts, name)
  return installReleaseArtifact(paths, platform, artifactPath, await sha256File(artifactPath))
}

function findFile(root: string, predicate: (filePath: string) => boolean): string | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const filePath = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = findFile(filePath, predicate)
      if (nested) return nested
    } else if (predicate(filePath)) {
      return filePath
    }
  }
  return undefined
}

export function installReleaseArtifact(
  paths: RunPaths,
  platform: Platform,
  artifactPath: string,
  artifactSha256: string
): InstallationRecord {
  if (!isPathInside(paths.artifacts, artifactPath)) throw new Error('Release artifact is outside the run directory')

  let executablePath: string
  let installedPath: string
  if (platform === 'macos') {
    const mountPath = join(paths.root, 'dmg-mount')
    mkdirSync(mountPath, { recursive: true })
    try {
      execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPath, artifactPath], {
        stdio: 'ignore',
        timeout: 60_000
      })
      const sourceApp = readdirSync(mountPath)
        .map((name) => join(mountPath, name))
        .find((candidate) => candidate.toLowerCase().endsWith('.app') && statSync(candidate).isDirectory())
      if (!sourceApp) throw new Error('The DMG does not contain an application bundle')
      installedPath = join(paths.installed, basename(sourceApp))
      execFileSync('ditto', [sourceApp, installedPath], { stdio: 'ignore', timeout: 120_000 })
    } finally {
      try {
        execFileSync('hdiutil', ['detach', mountPath], { stdio: 'ignore', timeout: 30_000 })
      } catch {
        // The attach failure path has nothing to detach.
      }
    }
    executablePath =
      findFile(join(installedPath, 'Contents', 'MacOS'), (candidate) => statSync(candidate).isFile()) ?? ''
  } else {
    installedPath = paths.installed
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(GH|GITHUB)_(TOKEN|ENTERPRISE_TOKEN)$/i.test(key))
    )
    execFileSync(artifactPath, ['/S', `/D=${installedPath}`], {
      stdio: 'ignore',
      timeout: 180_000,
      env: environment
    })
    executablePath =
      findFile(installedPath, (candidate) => basename(candidate).toLowerCase() === 'cherry studio.exe') ?? ''
  }

  if (!executablePath || !existsSync(executablePath))
    throw new Error('Installed Cherry Studio executable was not found')
  const record = {
    artifactName: basename(artifactPath),
    artifactPath,
    artifactSha256,
    executablePath,
    installedPath
  }
  writeFileSync(paths.installation, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  return record
}
