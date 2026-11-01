import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

import type { Platform } from './types'

export type RunnerArch = 'arm64' | 'x64'

export function normalizeRunnerArch(arch: string): RunnerArch {
  const normalized = arch.toLowerCase()
  if (normalized === 'x64' || normalized === 'amd64' || normalized === 'x86_64') return 'x64'
  if (normalized === 'arm64' || normalized === 'aarch64') return 'arm64'
  throw new Error(`Unsupported runner architecture: ${arch}`)
}

export function selectReleaseAsset(assetNames: string[], platform: Platform, arch: RunnerArch): string {
  const suffix = platform === 'windows' ? `-${arch}-setup.exe` : `-${arch}.dmg`
  const matches = assetNames.filter((name) => name.toLowerCase().endsWith(suffix.toLowerCase()))
  if (matches.length === 0) throw new Error(`No ${platform} ${arch} installer asset found`)
  if (matches.length > 1) throw new Error(`Multiple ${platform} ${arch} installer assets found: ${matches.join(', ')}`)
  return matches[0]
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', resolve)
    input.on('error', reject)
  })
  return hash.digest('hex')
}
