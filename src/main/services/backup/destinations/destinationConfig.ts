import { application } from '@application'
import { decryptToken } from '@main/services/nutstore/NutstoreService'
import type { BackupDestinationId } from '@shared/ipc/schemas/backup'
import { NUTSTORE_HOST } from '@shared/utils/nutstore'

import { DestinationNotConfiguredError } from '../errors'

/**
 * Where a backup goes, resolved from settings this process reads itself.
 *
 * CREDENTIALS NEVER CROSS IPC. The renderer names a destination; the secret that
 * reaches the server is read here, from Preference, and never travels back out.
 * The legacy channels this replaces took a full config object as an IPC
 * argument, which put the S3 secret key and the WebDAV password on the wire for
 * every backup and every listing.
 */

export interface WebDavDestination {
  readonly kind: 'webdav'
  readonly host: string
  readonly user: string
  readonly pass: string
  readonly path: string
  readonly maxBackups: number
  /**
   * Some WebDAV servers reject chunked bodies. The knob stays because the
   * failure it works around is the server's, not something this app can detect.
   */
  readonly disableStream: boolean
}

export interface S3Destination {
  readonly kind: 's3'
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly root: string
  readonly maxBackups: number
}

export interface LocalDestination {
  readonly kind: 'local'
  readonly dir: string
  readonly maxBackups: number
}

export type ResolvedDestination = WebDavDestination | S3Destination | LocalDestination

function preferences() {
  return application.get('PreferenceService')
}

function requireAll(destination: BackupDestinationId, fields: Record<string, string>): void {
  const missing = Object.entries(fields)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new DestinationNotConfiguredError(destination, missing.join(', '))
  }
}

async function resolveNutstore(): Promise<WebDavDestination> {
  const token = preferences().get('data.backup.nutstore.token')
  requireAll('nutstore', { token })

  const credentials = await decryptToken(token)
  if (!credentials) {
    throw new DestinationNotConfiguredError('nutstore', 'token could not be decrypted')
  }

  return {
    kind: 'webdav',
    host: NUTSTORE_HOST,
    user: credentials.username,
    pass: credentials.access_token,
    path: preferences().get('data.backup.nutstore.path'),
    maxBackups: preferences().get('data.backup.nutstore.max_backups'),
    disableStream: false
  }
}

/**
 * Read the destination's settings, or refuse before anything is attempted.
 *
 * Refusing here is what keeps an unconfigured destination quiet: a scheduled
 * backup can tell "not set up" from "upload failed" and skip the second one's
 * error reporting entirely.
 */
export async function resolveDestination(id: BackupDestinationId): Promise<ResolvedDestination> {
  if (id === 'nutstore') return resolveNutstore()

  if (id === 'webdav') {
    const host = preferences().get('data.backup.webdav.host')
    const user = preferences().get('data.backup.webdav.user')
    const pass = preferences().get('data.backup.webdav.pass')
    requireAll('webdav', { host, user, pass })
    return {
      kind: 'webdav',
      host,
      user,
      pass,
      path: preferences().get('data.backup.webdav.path'),
      maxBackups: preferences().get('data.backup.webdav.max_backups'),
      disableStream: preferences().get('data.backup.webdav.disable_stream')
    }
  }

  if (id === 's3') {
    const endpoint = preferences().get('data.backup.s3.endpoint')
    const bucket = preferences().get('data.backup.s3.bucket')
    const accessKeyId = preferences().get('data.backup.s3.access_key_id')
    const secretAccessKey = preferences().get('data.backup.s3.secret_access_key')
    requireAll('s3', { endpoint, bucket, accessKeyId, secretAccessKey })
    return {
      kind: 's3',
      endpoint,
      region: preferences().get('data.backup.s3.region'),
      bucket,
      accessKeyId,
      secretAccessKey,
      root: preferences().get('data.backup.s3.root'),
      maxBackups: preferences().get('data.backup.s3.max_backups')
    }
  }

  const dir = preferences().get('data.backup.local.dir')
  requireAll('local', { dir })
  return { kind: 'local', dir, maxBackups: preferences().get('data.backup.local.max_backups') }
}
