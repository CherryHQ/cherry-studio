import type { FileMetadata } from '@renderer/types'

const FILE_COMPOSER_TOKEN_ID_PREFIX = 'file:'

export type ComposerFileMetadata = FileMetadata & { fileTokenSourceId: string }

function createSecureRandomHex(byteLength = 16): string | null {
  const crypto = globalThis.crypto
  const getRandomValues = crypto?.getRandomValues?.bind(crypto)
  if (!getRandomValues) return null

  const bytes = new Uint8Array(byteLength)
  getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createComposerSecureRandomId(prefix: string): string | null {
  const crypto = globalThis.crypto
  const randomUUID = crypto?.randomUUID?.bind(crypto)
  if (randomUUID) return randomUUID()

  const randomHex = createSecureRandomHex()
  return randomHex ? `${prefix}-${randomHex}` : null
}

export function isComposerFileTokenPathLike(value: string) {
  return (
    value.toLowerCase().startsWith('file://') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(value)
  )
}

export function isComposerFileTokenSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !isComposerFileTokenPathLike(value)
}

export function createComposerFileTokenSourceId(): string {
  const sourceId = createComposerSecureRandomId('file-token')
  if (!sourceId) {
    throw new Error('Secure random generation is required to create a composer file token source id')
  }
  return sourceId
}

export function withComposerFileTokenSourceId<T extends FileMetadata>(file: T): T & ComposerFileMetadata {
  if (getComposerFileTokenSourceId(file)) return file as T & ComposerFileMetadata
  return { ...file, fileTokenSourceId: createComposerFileTokenSourceId() }
}

export function withComposerFileTokenSourceIds(files: readonly FileMetadata[]): ComposerFileMetadata[] {
  let changed = false
  const nextFiles = files.map((file) => {
    const nextFile = withComposerFileTokenSourceId(file)
    if (nextFile !== file) changed = true
    return nextFile
  })

  return changed ? nextFiles : (files as ComposerFileMetadata[])
}

export function composerFileTokenIdFromSourceId(sourceId: string) {
  return `${FILE_COMPOSER_TOKEN_ID_PREFIX}${sourceId}`
}

export function readComposerFileTokenIdSuffix(tokenId: string): string | undefined {
  if (!tokenId.startsWith(FILE_COMPOSER_TOKEN_ID_PREFIX)) return undefined
  const sourceId = tokenId.slice(FILE_COMPOSER_TOKEN_ID_PREFIX.length)
  return sourceId || undefined
}

export function readComposerFileTokenSourceIdFromTokenId(tokenId: string): string | undefined {
  const sourceId = readComposerFileTokenIdSuffix(tokenId)
  return isComposerFileTokenSourceId(sourceId) ? sourceId : undefined
}

export function getComposerFileTokenSourceId(file: Pick<FileMetadata, 'fileTokenSourceId'>): string | undefined {
  if (isComposerFileTokenSourceId(file.fileTokenSourceId)) return file.fileTokenSourceId
  return undefined
}
