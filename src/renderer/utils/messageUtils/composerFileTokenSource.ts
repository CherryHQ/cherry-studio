import type { FileMetadata } from '@renderer/types'
import { v4 as uuidv4 } from 'uuid'

const FILE_COMPOSER_TOKEN_ID_PREFIX = 'file:'

export type ComposerFileMetadata = FileMetadata & { fileTokenSourceId: string }

export function createComposerSecureRandomId(prefix: string): string {
  return `${prefix}-${uuidv4()}`
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
  return createComposerSecureRandomId('file-token')
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
