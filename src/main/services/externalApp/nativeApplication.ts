import { createHash } from 'node:crypto'
import path from 'node:path'

import { app, nativeImage } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import type { AbsoluteFilePath } from '@shared/types/file'

const applicationSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  iconPath: z.string().optional(),
  iconDataUrl: z.string().startsWith('data:image/png;base64,').optional()
})
const listingSchema = z.object({
  applications: z.array(applicationSchema.extend({ id: z.string().min(1) })),
  defaultApplication: applicationSchema.nullable()
})
const addonSchema = z.object({
  list: z.custom<(targetPath: string) => Promise<unknown>>((value) => typeof value === 'function'),
  open: z.custom<(targetPath: string, applicationId: string) => Promise<void>>((value) => typeof value === 'function')
})

export type NativeApplication = z.infer<typeof applicationSchema>

function loadAddon() {
  return addonSchema.parse(require(application.getPath('feature.external_app.native_file')))
}

export function nativeTargetId(id: string): string {
  return `native:${createHash('sha256').update(id).digest('hex')}`
}

export async function listNativeApplications(targetPath: AbsoluteFilePath) {
  return listingSchema.parse(await loadAddon().list(targetPath))
}

export async function openNativeApplication(targetPath: AbsoluteFilePath, applicationId: string): Promise<void> {
  await loadAddon().open(targetPath, applicationId)
}

export async function nativeApplicationIcon(info: NativeApplication): Promise<string | undefined> {
  if (info.iconDataUrl) return info.iconDataUrl
  if (!info.iconPath || !path.isAbsolute(info.iconPath)) return undefined
  try {
    const icon =
      process.platform === 'linux'
        ? nativeImage.createFromPath(info.iconPath).resize({ width: 32, height: 32 })
        : await app.getFileIcon(info.iconPath, { size: 'normal' })
    return icon.isEmpty() ? undefined : icon.toDataURL()
  } catch {
    return undefined
  }
}
