import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { resolveDshRuntimeArtifact } from '@cherrystudio/dsh-bridge'
import { cleanupOtherArtifactVersions, ensureBundledTree } from '@main/services/bundledArtifact'
import { bundledArtifactPlatformKey, readBundledArtifactManifestAt } from '@main/utils/bundledArtifactManifest'
import { app } from 'electron'

let installationPromise: Promise<string> | null = null

function assertRuntimeEntrypoints(root: string, entrypoints: readonly string[]): Promise<void> {
  return Promise.all(
    entrypoints.map(async (entrypoint) => {
      const candidate = path.resolve(root, ...entrypoint.split('/'))
      const relative = path.relative(root, candidate)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`DSH runtime entrypoint escapes cache root: ${entrypoint}`)
      }
      try {
        const stat = await fsp.stat(candidate)
        if (!stat.isFile()) throw new Error('not a regular file')
      } catch (error) {
        throw new Error(`DSH runtime entrypoint is not a file: ${entrypoint}`, { cause: error })
      }
    })
  ).then(() => undefined)
}

async function installDshRuntime(): Promise<string> {
  const artifactLocation = resolveDshRuntimeArtifact()
  const manifest = readBundledArtifactManifestAt(artifactLocation.manifestPath)
  const artifact = manifest.artifacts['dsh-runtime']
  if (!artifact || artifact.kind !== 'tree' || artifact.compression !== 'zstd') {
    throw new Error(`Bundled DSH runtime payload missing for ${bundledArtifactPlatformKey()}`)
  }

  const cacheRoot = application.getPath('feature.agents.dsh.runtime')
  const destination = path.join(
    cacheRoot,
    artifact.version,
    bundledArtifactPlatformKey(manifest.platform, manifest.arch)
  )
  const result = await ensureBundledTree(manifest, artifact, destination, { archiveRoot: artifactLocation.archiveRoot })
  await assertRuntimeEntrypoints(result.root, artifact.entrypoints)
  await cleanupOtherArtifactVersions(cacheRoot, artifact.version)
  return result.root
}

/** Ensure the packaged DSH subprocess tree is installed into the verified Toolchain cache. */
export function ensureDshRuntime(): Promise<string | undefined> {
  if (!app.isPackaged) return Promise.resolve(undefined)
  if (!installationPromise) {
    const task = installDshRuntime()
    const wrapped = task.finally(() => {
      if (installationPromise === wrapped) installationPromise = null
    })
    installationPromise = wrapped
  }
  return installationPromise
}
