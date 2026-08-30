/**
 * Packaged icon -> the existing mini app logo slot.
 *
 * Reusing the logo pipeline (`setInstalledMiniAppLogo`) means the bytes go through `transcodeToEntityWebp`
 * (128x128 WebP, decompression-bomb guarded) into `mini_app_logo_file_ref`, so
 * the launcher and tab icons need no change and uninstall reclaims the file
 * through the normal ref-count GC.
 */

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { setInstalledMiniAppLogo } from '@main/services/entityLogo'
import type { MiniAppManifest } from '@shared/types/miniAppManifest'
import { fileTypeFromBuffer } from 'file-type'

const logger = loggerService.withContext('miniAppIcon')

/** What a mini app icon may be. Everything else is refused before a decoder sees it. */
const ICON_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/**
 * Format allowlist on the bytes THEMSELVES, ahead of `transcodeToEntityWebp`.
 *
 * libvips dispatches on magic bytes, not on the manifest's filename, so an `icon.png`
 * that is really SVG reaches librsvg plus the text-shaping stack, and one that is really
 * HEIF reaches libheif. Mini apps are the first source of author-chosen REMOTE bytes on
 * that path, and they hit it at preview time — before the user has consented to anything.
 *
 * Deliberately NOT enforced inside `transcodeToEntityWebp`: that would narrow what user
 * avatars and provider logos accept, which is not this feature's call to make.
 */
export async function assertSupportedIconBytes<T extends Uint8Array>(bytes: T): Promise<T> {
  const type = await fileTypeFromBuffer(bytes)
  if (type === undefined || !ICON_MIME_TYPES.has(type.mime)) {
    throw new Error(`Mini app icon must be PNG, JPEG or WebP, not ${type?.mime ?? 'an unrecognised format'}`)
  }
  return bytes
}

async function readContainedIcon(installPath: string, iconRel: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const root = await fs.promises.realpath(installPath)
  const real = await fs.promises.realpath(path.join(root, iconRel))
  if (real !== root && !real.startsWith(root + path.sep)) {
    logger.warn('Package icon resolves outside the package root', { installPath, iconRel })
    return undefined
  }
  return assertSupportedIconBytes(new Uint8Array(await fs.promises.readFile(real)))
}

/** Never throws: a bad icon degrades to the default logo, it does not fail an install. */
export async function applyPackagedIcon(appId: string, installPath: string, manifest: MiniAppManifest): Promise<void> {
  if (manifest.icon) {
    try {
      const data = await readContainedIcon(installPath, manifest.icon.path)
      if (data) {
        await setInstalledMiniAppLogo(appId, { kind: 'image', data })
        return
      }
    } catch (error) {
      logger.warn('Failed to apply packaged icon, falling back to default', error as Error)
    }
  }
  await setInstalledMiniAppLogo(appId, { kind: 'default' })
}
