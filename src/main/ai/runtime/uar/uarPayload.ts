import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { isWin } from '@main/core/platform'
import { toAsarUnpackedPath } from '@main/utils/asar'

export type UarPayload = {
  executable: string
  modelsDirectory: string
  source: 'override' | 'packaged'
  version?: string
}

type UarPayloadManifest = {
  schema: number
  name: string
  version: string
  platform: string
  files: Array<{ path: string }>
}

function readManifest(payloadDirectory: string): UarPayloadManifest | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(payloadDirectory, 'payload-manifest.json'), 'utf8')
    ) as UarPayloadManifest
    if (
      manifest.schema !== 1 ||
      manifest.name !== 'uar-sidecar' ||
      !manifest.version?.trim() ||
      manifest.platform !== `${process.platform}-${process.arch}` ||
      !Array.isArray(manifest.files)
    ) {
      return undefined
    }
    const declaredFiles = new Set<string>()
    for (const entry of manifest.files) {
      if (!entry || typeof entry.path !== 'string' || entry.path.includes('\\') || path.posix.isAbsolute(entry.path)) {
        return undefined
      }
      const relative = path.posix.normalize(entry.path)
      if (relative !== entry.path || relative === '..' || relative.startsWith('../')) return undefined
      if (!existsSync(path.join(payloadDirectory, ...relative.split('/')))) return undefined
      declaredFiles.add(relative)
    }
    const executable = isWin ? 'uar-sidecar.exe' : 'uar-sidecar'
    if (!declaredFiles.has(executable) || !declaredFiles.has('uar-models/config.json')) return undefined
    return manifest
  } catch {
    return undefined
  }
}

function payloadAt(executable: string, source: UarPayload['source']): UarPayload | undefined {
  const payloadDirectory = path.dirname(executable)
  const modelsDirectory = path.join(payloadDirectory, 'uar-models')
  const manifest = readManifest(payloadDirectory)
  if (!manifest || !existsSync(executable)) return undefined
  return { executable, modelsDirectory, source, version: manifest.version.trim() }
}

export function inspectUarPayload(): UarPayload | undefined {
  const override = process.env.THE_BOSS_UAR_SIDECAR_PATH?.trim()
  if (override) return payloadAt(path.resolve(override), 'override')

  const platformDirectory = toAsarUnpackedPath(
    path.join(application.getPath('app.root.resources.binaries'), `${process.platform}-${process.arch}`)
  )
  return payloadAt(path.join(platformDirectory, `uar-sidecar${isWin ? '.exe' : ''}`), 'packaged')
}

export function requireUarPayload(): UarPayload {
  const payload = inspectUarPayload()
  if (payload) return payload
  if (process.env.THE_BOSS_UAR_SIDECAR_PATH?.trim()) {
    throw new Error('Configured UAR sidecar payload is incomplete or unavailable')
  }
  throw new Error('Packaged UAR sidecar payload is incomplete or unavailable')
}
