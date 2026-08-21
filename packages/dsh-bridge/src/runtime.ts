import { createRequire } from 'node:module'
import path from 'node:path'

const require_ = createRequire(import.meta.url)

export function resolveDshRuntimeEntry(specifier: string): string {
  return require_.resolve(specifier)
}

export interface DshRuntimeArtifactLocation {
  manifestPath: string
  archiveRoot: string
}

/** Locate the package-owned runtime payload without materializing or installing it. */
export function resolveDshRuntimeArtifact(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): DshRuntimeArtifactLocation {
  const manifestPath = require_.resolve(`./runtime/${platform}-${arch}/manifest.json`)
  return { manifestPath, archiveRoot: path.dirname(manifestPath) }
}
