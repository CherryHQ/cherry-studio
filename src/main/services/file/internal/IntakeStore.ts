import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { FileEntryIdSchema } from '@shared/data/types/file'

import { fileIntakeLimits } from '../intakeTypes'

const logger = loggerService.withContext('IntakeStore')
export const metadataSchema = z.object({
  uploadId: z.string().min(1).max(256),
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (name) =>
        !/[\\/:*?"<>|]/.test(name) &&
        !Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
        name !== '.' &&
        name !== '..' &&
        Buffer.byteLength(name) <= 255
    ),
  mediaType: z.string().max(128),
  byteLength: z.number().int().min(0).max(fileIntakeLimits.fileBytes)
})
export const recordSchema = metadataSchema
  .extend({
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    ownerId: z.string(),
    quotaKey: z.string(),
    offset: z.number().int().nonnegative(),
    epoch: z.number().int().nonnegative(),
    state: z.enum(['receiving', 'verifying', 'ready', 'failed', 'cancelled']),
    resumeId: z.string().optional(),
    entryId: FileEntryIdSchema.optional(),
    createdAt: z.number(),
    expiresAt: z.number()
  })
  .refine((record) => Boolean(record.sha256) || record.state !== 'ready', 'Missing upload digest')
export type Upload = z.infer<typeof recordSchema>

export class IntakeStore {
  readonly uploads = new Map<string, Upload>()
  readonly pins = new Map<string, number>()
  private loading?: Promise<void>
  private uncertain = false

  root(): string {
    return application.getPath('feature.files.intakes')
  }
  key(owner: { ownerId: string }, id: string): string {
    return createHash('sha256')
      .update(JSON.stringify([owner.ownerId, id]))
      .digest('hex')
  }
  directory(upload: Upload): string {
    return path.join(this.root(), this.key(upload, upload.uploadId))
  }
  file(upload: Upload): string {
    return path.join(this.directory(upload), 'data', upload.filename)
  }

  async syncDirectory(directory: string): Promise<void> {
    if (process.platform === 'win32') return
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async save(upload: Upload): Promise<void> {
    const directory = this.directory(upload)
    const handle = await open(path.join(directory, 'state.tmp'), 'w', 0o600)
    try {
      await handle.writeFile(JSON.stringify(upload))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(path.join(directory, 'state.tmp'), path.join(directory, 'state.json'))
    await this.syncDirectory(directory)
    this.uploads.set(this.key(upload, upload.uploadId), upload)
  }

  load(): Promise<void> {
    return (this.loading ??= (async () => {
      await mkdir(this.root(), { recursive: true })
      for (const key of await readdir(this.root())) {
        if (!/^[a-f0-9]{64}$/.test(key)) continue
        try {
          const upload = recordSchema.parse(
            JSON.parse(await readFile(path.join(this.root(), key, 'state.json'), 'utf8'))
          )
          if (
            this.key(upload, upload.uploadId) !== key ||
            upload.offset > upload.byteLength ||
            (upload.state === 'ready' && !upload.entryId)
          )
            throw new Error('Invalid intake checkpoint')
          this.uploads.set(key, upload)
        } catch (error) {
          this.uncertain = true
          logger.error('Intake checkpoint recovery failed; automatic file cleanup deferred', { key, error })
        }
      }
    })())
  }

  isProtected(entryId: string): boolean {
    if (this.uncertain) return true
    return [...this.uploads.entries()].some(
      ([key, upload]) =>
        upload.entryId === entryId &&
        (this.pins.has(key) ||
          upload.state === 'verifying' ||
          (upload.state !== 'cancelled' && upload.expiresAt > Date.now()))
    )
  }
}
