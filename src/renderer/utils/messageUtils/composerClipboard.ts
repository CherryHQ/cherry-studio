import { loggerService } from '@logger'
import { FILE_TYPE, type FileMetadata, type FileType } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { type CherryFileMeta, type ComposerMessageToken, readCherryMeta } from '@shared/data/types/uiParts'
import { type FileURLString } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file/fileType'
import { fileUrlToPath } from '@shared/utils/file/urlUtil'

import { type ComposerAttachment, toComposerAttachment } from './composerAttachment'
import {
  createComposerSecureRandomId,
  isComposerFileTokenPathLike,
  readComposerFileTokenIdSuffix,
  readComposerFileTokenSourceIdFromTokenId,
  withComposerFileTokenSourceId
} from './composerFileTokenSource'

const logger = loggerService.withContext('composerClipboard')

export const COMPOSER_CLIPBOARD_FRAGMENT_MIME = 'web application/x-cherry-composer-fragment+json'

const COMPOSER_CLIPBOARD_FRAGMENT_VERSION = 1
const COMPOSER_CLIPBOARD_FRAGMENT_MAX_LENGTH = 250_000
const COMPOSER_CLIPBOARD_TOKEN_KINDS = ['skill', 'file', 'knowledge', 'reference', 'quote', 'promptVariable'] as const
const COMPOSER_CLIPBOARD_FILE_HANDLE_TTL_MS = 30 * 60 * 1000

type ComposerClipboardTokenKind = (typeof COMPOSER_CLIPBOARD_TOKEN_KINDS)[number]

export interface ComposerClipboardSourceToken {
  id: string
  kind: string
  label: string
  description?: string
  promptText?: string
  payload?: unknown
}

export interface ComposerClipboardToken {
  id: string
  kind: ComposerClipboardTokenKind
  label: string
  description?: string
  promptText?: string
  payload?: {
    type?: string
    ext?: string
    name?: string
    origin_name?: string
    size?: number
    handle?: string
  }
}

export type ComposerClipboardSegment =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'token'
      token: ComposerClipboardToken
      fallbackText: string
    }

// Write-side segment: tokens are unsanitized source tokens. Sanitization (and
// file handle registration) happens exactly once, in createComposerClipboardFragment.
type ComposerClipboardSourceSegment =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'token'
      token: ComposerClipboardSourceToken
      fallbackText: string
    }

export interface ComposerClipboardFragment {
  version: 1
  segments: ComposerClipboardSegment[]
}

export interface ComposerRichClipboardContent {
  plainText: string
  html: string
  customFormats?: Record<string, string>
}

interface ComposerClipboardProjection {
  plainText: string
  segments: ComposerClipboardSourceSegment[]
  hasToken: boolean
}

type FileClipboardPayload = NonNullable<ComposerClipboardToken['payload']> & {
  id?: string
  path?: string
  fileTokenSourceId?: string
}
type ClipboardComposerMessageToken = Omit<ComposerMessageToken, 'payload'> & {
  payload?: FileClipboardPayload
}
type ComposerClipboardDraftToken = ComposerClipboardSourceToken & {
  index: number
  textOffset: number
}
interface ComposerClipboardDraft {
  text: string
  tokens: readonly ComposerClipboardDraftToken[]
}

const COMPOSER_CLIPBOARD_MESSAGE_TOKEN_KINDS = new Set<ComposerMessageToken['kind']>([
  'skill',
  'file',
  'knowledge',
  'reference',
  'quote'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function getFileExtensionFromName(name: string | undefined) {
  return name?.match(/\.[^.]+$/)?.[0] ?? ''
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stripFileUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!value.startsWith('file://')) return value

  try {
    return fileUrlToPath(value as FileURLString)
  } catch {
    return value.replace(/^file:\/\//, '')
  }
}

function isFileType(value: unknown): value is FileType {
  return typeof value === 'string' && Object.values(FILE_TYPE).includes(value as FileType)
}

function readFileDisplayPayload(
  payload: unknown,
  options: { includeHandle?: boolean } = {}
): FileClipboardPayload | undefined {
  if (!isRecord(payload)) return undefined

  const result: FileClipboardPayload = {}
  const type = readString(payload.type)
  const ext = readString(payload.ext)
  const name = readString(payload.name)
  const originName = readString(payload.origin_name)
  const handle = readString(payload.handle)

  if (type) result.type = type
  if (ext) result.ext = ext
  if (name) result.name = name
  if (originName) result.origin_name = originName
  if (readNumber(payload.size) !== undefined) result.size = readNumber(payload.size)
  if (options.includeHandle && handle) result.handle = handle

  return Object.keys(result).length > 0 ? result : undefined
}

interface FileRestorationRegistryEntry {
  sourceId: string
  file: FileMetadata
  expiresAt: number
}

const fileRestorationRegistry = new Map<string, FileRestorationRegistryEntry>()

function createFileRestorationHandle() {
  return createComposerSecureRandomId('composer-file')
}

function pruneExpiredFileRestorationHandles(now = Date.now()) {
  for (const [handle, entry] of fileRestorationRegistry) {
    if (entry.expiresAt <= now) fileRestorationRegistry.delete(handle)
  }
}

function registerFileRestorationHandle(file: FileMetadata): string {
  pruneExpiredFileRestorationHandles()

  const restorableFile = withComposerFileTokenSourceId(file)
  const handle = createFileRestorationHandle()

  fileRestorationRegistry.set(handle, {
    sourceId: restorableFile.fileTokenSourceId,
    file: restorableFile,
    expiresAt: Date.now() + COMPOSER_CLIPBOARD_FILE_HANDLE_TTL_MS
  })
  return handle
}

function resolveFileRestorationHandle(handle: string, sourceId: string): FileMetadata | null {
  pruneExpiredFileRestorationHandles()

  const entry = fileRestorationRegistry.get(handle)
  if (!entry || entry.sourceId !== sourceId) return null
  return { ...entry.file }
}

function createFileMetadataFromWritePayload(
  token: Pick<ComposerClipboardSourceToken, 'id' | 'label'>,
  payload: unknown
): FileMetadata | null {
  if (!isRecord(payload)) return null

  const sourceId = readComposerFileTokenSourceIdFromTokenId(token.id)
  const payloadSourceId = readString(payload.fileTokenSourceId)
  const path = stripFileUrl(readString(payload.path))
  if (!sourceId || payloadSourceId !== sourceId || !path) return null

  const name = readString(payload.name) || readString(payload.origin_name) || token.label
  const ext = readString(payload.ext) || getFileExtensionFromName(name)
  const type = isFileType(payload.type) ? payload.type : getFileTypeByExt(ext)
  const rawId = readString(payload.id)

  return {
    id: rawId && !hasUnsafeComposerClipboardFileTokenId({ id: rawId, kind: 'file' }) ? rawId : sourceId,
    fileTokenSourceId: sourceId,
    name,
    origin_name: readString(payload.origin_name) || name,
    path,
    size: readNumber(payload.size) ?? 0,
    ext,
    type,
    created_at: readString(payload.created_at) ?? '',
    count: readNumber(payload.count) ?? 1
  }
}

function createFilePayloadForWrite(token: Pick<ComposerClipboardSourceToken, 'id' | 'label' | 'payload'>) {
  const payload = readFileDisplayPayload(token.payload)
  const file = createFileMetadataFromWritePayload(token, token.payload)
  const handle = file ? registerFileRestorationHandle(file) : null
  if (!handle) return payload

  return {
    ...payload,
    handle
  }
}

function isComposerClipboardTokenKind(value: unknown): value is ComposerClipboardTokenKind {
  return typeof value === 'string' && COMPOSER_CLIPBOARD_TOKEN_KINDS.includes(value as ComposerClipboardTokenKind)
}

function hasUnsafeComposerClipboardFileTokenId(token: Pick<ComposerClipboardSourceToken, 'id' | 'kind'>) {
  if (token.kind !== 'file') return false

  const id = readComposerFileTokenIdSuffix(token.id) ?? token.id
  return isComposerFileTokenPathLike(id)
}

function isUnsafeComposerClipboardFileToken(token: unknown) {
  if (!isRecord(token)) return false

  const id = readString(token.id)
  return Boolean(id && token.kind === 'file' && hasUnsafeComposerClipboardFileTokenId({ id, kind: 'file' }))
}

function isComposerClipboardToken<T extends Pick<ComposerClipboardSourceToken, 'id' | 'kind'>>(
  token: T
): token is T & { kind: ComposerClipboardToken['kind'] } {
  return isComposerClipboardTokenKind(token.kind) && !hasUnsafeComposerClipboardFileTokenId(token)
}

function escapeComposerClipboardHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Plain text → minimal safe HTML: one paragraph, newlines as <br>.
function createComposerClipboardTextHtml(text: string): string {
  const inlineHtml = escapeComposerClipboardHtmlText(text).replace(/\r\n?|\n/g, '<br>')
  return `<p>${inlineHtml || '<br>'}</p>`
}

function sanitizeComposerClipboardToken(token: unknown, mode: 'read' | 'write'): ComposerClipboardToken | null {
  if (!isRecord(token)) return null

  const id = readString(token.id)
  const kind = token.kind
  const label = readString(token.label)
  if (!id || !isComposerClipboardTokenKind(kind) || !label) return null
  if (hasUnsafeComposerClipboardFileTokenId({ id, kind })) return null

  const description = readString(token.description)
  const promptText = readString(token.promptText)
  const payload =
    kind === 'file'
      ? mode === 'write'
        ? createFilePayloadForWrite({ id, label, payload: token.payload })
        : readFileDisplayPayload(token.payload, { includeHandle: true })
      : undefined

  return {
    id,
    kind,
    label,
    ...(description && { description }),
    ...(promptText && { promptText }),
    ...(payload && { payload })
  }
}

function sanitizeComposerClipboardSegment(segment: unknown): ComposerClipboardSegment | null {
  if (!isRecord(segment)) return null

  if (segment.type === 'text') {
    const text = readString(segment.text)
    return text ? { type: 'text', text } : null
  }

  if (segment.type !== 'token') return null

  const fallbackText = readString(segment.fallbackText)
  if (!fallbackText) return null

  const token = sanitizeComposerClipboardToken(segment.token, 'read')
  if (!token) {
    return isUnsafeComposerClipboardFileToken(segment.token) ? { type: 'text', text: fallbackText } : null
  }

  return { type: 'token', token, fallbackText }
}

export function createComposerClipboardFragment(segments: readonly ComposerClipboardSourceSegment[]): string {
  const safeSegments = segments.flatMap((segment): ComposerClipboardSegment[] => {
    if (segment.type === 'text') return segment.text ? [{ type: 'text', text: segment.text }] : []

    const token = sanitizeComposerClipboardToken(segment.token, 'write')
    if (!token) return segment.fallbackText ? [{ type: 'text', text: segment.fallbackText }] : []

    return [{ type: 'token', token, fallbackText: segment.fallbackText }]
  })

  return JSON.stringify({
    version: COMPOSER_CLIPBOARD_FRAGMENT_VERSION,
    segments: safeSegments
  } satisfies ComposerClipboardFragment)
}

function getTokenFallbackText(
  token: Pick<ComposerClipboardSourceToken, 'id' | 'kind' | 'label' | 'description' | 'promptText'>
): string {
  if (token.kind === 'quote') return token.promptText ?? token.description ?? token.label
  if (token.kind === 'promptVariable') return token.promptText ?? token.description ?? token.label
  if (token.kind === 'skill') {
    const marker = token.id.startsWith('skill:') ? token.id.slice('skill:'.length) : token.label
    return `/${marker}/`
  }
  if (token.kind === 'knowledge') {
    const marker = token.id.startsWith('knowledge:') ? token.id.slice('knowledge:'.length) : token.label
    return `#${marker}#`
  }
  return token.promptText ?? token.label
}

function readMessageFilePayload(part: CherryMessagePart): FileClipboardPayload | undefined {
  if ((part as { type?: string }).type !== 'file') return undefined

  const filePart = part as {
    filename?: string
    mediaType?: string
    url?: string
  }
  const cherry = readCherryMeta(part) as CherryFileMeta | undefined
  const fileTokenSourceId = cherry?.fileTokenSourceId
  if (!fileTokenSourceId) return undefined

  const path = stripFileUrl(filePart.url)
  if (!path) return undefined

  const name = filePart.filename || path.split(/[\\/]/).pop() || ''
  const ext = getFileExtensionFromName(name)
  return {
    id: cherry.fileEntryId ?? fileTokenSourceId,
    fileTokenSourceId,
    type: filePart.mediaType?.startsWith('image/') ? FILE_TYPE.IMAGE : getFileTypeByExt(ext),
    ...(ext && { ext }),
    ...(name && { name, origin_name: name }),
    path
  }
}

function collectFilePayloadsBySourceId(parts: readonly CherryMessagePart[]): Map<string, FileClipboardPayload> {
  const payloads = new Map<string, FileClipboardPayload>()

  for (const part of parts) {
    const payload = readMessageFilePayload(part)
    if (!payload) continue

    payloads.set(payload.fileTokenSourceId!, payload)
  }

  return payloads
}

function mergeFileTokenPayload(
  token: ComposerMessageToken,
  filePayloadsBySourceId: ReadonlyMap<string, FileClipboardPayload>
): ClipboardComposerMessageToken {
  if (token.kind !== 'file') return token

  const tokenPayload = readFileDisplayPayload(token.payload) ?? undefined
  const sourceId = readComposerFileTokenSourceIdFromTokenId(token.id)
  const matchingFilePayload = sourceId ? filePayloadsBySourceId.get(sourceId) : undefined

  if (!matchingFilePayload) {
    return tokenPayload ? { ...token, payload: tokenPayload } : token
  }

  return {
    ...token,
    payload: {
      ...matchingFilePayload,
      ...tokenPayload,
      path: matchingFilePayload.path,
      fileTokenSourceId: sourceId
    }
  } satisfies ClipboardComposerMessageToken
}

function appendTextSegment(segments: ComposerClipboardSourceSegment[], text: string) {
  if (!text) return
  const last = segments[segments.length - 1]
  if (last?.type === 'text') {
    last.text += text
    return
  }
  segments.push({ type: 'text', text })
}

function appendTokenSegment(
  segments: ComposerClipboardSourceSegment[],
  token: ComposerClipboardSourceToken,
  fallbackText: string
): boolean {
  if (!token.id || !token.label || !isComposerClipboardToken(token)) {
    appendTextSegment(segments, fallbackText)
    return Boolean(fallbackText)
  }
  if (!fallbackText) return false

  segments.push({ type: 'token', token, fallbackText })
  return true
}

function projectTokensOverText(
  text: string,
  tokens: readonly (ComposerClipboardSourceToken & { textOffset: number })[]
): ComposerClipboardProjection {
  const segments: ComposerClipboardSourceSegment[] = []
  let plainText = ''
  let cursor = 0
  let hasToken = false

  for (const token of tokens) {
    const offset = Math.max(cursor, Math.min(text.length, token.textOffset))
    if (offset > cursor) {
      const chunk = text.slice(cursor, offset)
      plainText += chunk
      appendTextSegment(segments, chunk)
      cursor = offset
    }

    const fallbackText = getTokenFallbackText(token)
    plainText += fallbackText
    hasToken = appendTokenSegment(segments, token, fallbackText) || hasToken

    if (token.promptText && text.slice(offset, offset + token.promptText.length) === token.promptText) {
      cursor = Math.max(cursor, offset + token.promptText.length)
    }
  }

  if (cursor < text.length) {
    const chunk = text.slice(cursor)
    plainText += chunk
    appendTextSegment(segments, chunk)
  }

  return { plainText, segments, hasToken }
}

function projectTextPartToClipboardSegments(
  part: Extract<CherryMessagePart, { type: 'text' }>,
  filePayloadsBySourceId: ReadonlyMap<string, FileClipboardPayload>
): ComposerClipboardProjection {
  const composer = readCherryMeta(part)?.composer
  if (!composer?.tokens.length) {
    return {
      plainText: part.text,
      segments: part.text ? [{ type: 'text', text: part.text }] : [],
      hasToken: false
    }
  }

  const tokens = composer.tokens
    .filter((token) => COMPOSER_CLIPBOARD_MESSAGE_TOKEN_KINDS.has(token.kind) && token.label)
    .toSorted((a, b) => a.textOffset - b.textOffset || a.index - b.index)
    .map((token) => mergeFileTokenPayload(token, filePayloadsBySourceId))

  return projectTokensOverText(part.text, tokens)
}

function projectComposerClipboardPartGroup(parts: readonly CherryMessagePart[]): ComposerClipboardProjection {
  const filePayloadsBySourceId = collectFilePayloadsBySourceId(parts)
  const projections = parts
    .filter((part): part is Extract<CherryMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => projectTextPartToClipboardSegments(part, filePayloadsBySourceId))
    .filter((projection) => projection.plainText.trim().length > 0)

  const segments: ComposerClipboardSourceSegment[] = []
  projections.forEach((projection, index) => {
    if (index > 0) appendTextSegment(segments, '\n\n')
    projection.segments.forEach((segment) => {
      if (segment.type === 'text') appendTextSegment(segments, segment.text)
      else segments.push(segment)
    })
  })

  return {
    plainText: projections.map((projection) => projection.plainText).join('\n\n'),
    segments,
    hasToken: projections.some((projection) => projection.hasToken)
  }
}

function projectComposerClipboardDraft(draft: ComposerClipboardDraft): ComposerClipboardProjection {
  const tokens = draft.tokens
    .filter((token) => token.label || token.promptText)
    .toSorted((a, b) => a.textOffset - b.textOffset || a.index - b.index)

  return projectTokensOverText(draft.text, tokens)
}

function createComposerRichClipboardContentFromProjection(
  projection: ComposerClipboardProjection
): ComposerRichClipboardContent | null {
  if (!projection.hasToken || !projection.plainText) return null

  return {
    plainText: projection.plainText,
    html: createComposerClipboardTextHtml(projection.plainText),
    customFormats: {
      [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: createComposerClipboardFragment(projection.segments)
    }
  }
}

export function createComposerRichClipboardContentFromParts(
  parts: readonly CherryMessagePart[]
): ComposerRichClipboardContent | null {
  return createComposerRichClipboardContentFromProjection(projectComposerClipboardPartGroup(parts))
}

export function createComposerRichClipboardContentFromDraft(
  draft: ComposerClipboardDraft
): ComposerRichClipboardContent | null {
  return createComposerRichClipboardContentFromProjection(projectComposerClipboardDraft(draft))
}

export function createComposerRichClipboardContentFromPartGroups(
  partGroups: readonly (readonly CherryMessagePart[])[],
  separator: string
): ComposerRichClipboardContent | null {
  const projections = partGroups.map(projectComposerClipboardPartGroup).filter((projection) => projection.plainText)
  const segments: ComposerClipboardSourceSegment[] = []

  projections.forEach((projection, index) => {
    if (index > 0) appendTextSegment(segments, separator)
    projection.segments.forEach((segment) => {
      if (segment.type === 'text') appendTextSegment(segments, segment.text)
      else segments.push(segment)
    })
  })

  return createComposerRichClipboardContentFromProjection({
    plainText: projections.map((projection) => projection.plainText).join(separator),
    segments,
    hasToken: projections.some((projection) => projection.hasToken)
  })
}

export function createComposerAttachmentFromComposerClipboardToken(
  token: ComposerClipboardToken
): ComposerAttachment | null {
  if (token.kind !== 'file' || !token.payload?.handle) return null

  const sourceId = readComposerFileTokenSourceIdFromTokenId(token.id)
  if (!sourceId) return null

  const file = resolveFileRestorationHandle(token.payload.handle, sourceId)
  return file ? toComposerAttachment(file) : null
}

export function readComposerClipboardFragment(value: string): ComposerClipboardFragment | null {
  if (!value || value.length > COMPOSER_CLIPBOARD_FRAGMENT_MAX_LENGTH) return null

  try {
    const parsed = JSON.parse(value)
    if (
      !isRecord(parsed) ||
      parsed.version !== COMPOSER_CLIPBOARD_FRAGMENT_VERSION ||
      !Array.isArray(parsed.segments)
    ) {
      return null
    }

    const segments = parsed.segments.map(sanitizeComposerClipboardSegment)
    if (segments.some((segment) => segment === null)) return null

    return {
      version: COMPOSER_CLIPBOARD_FRAGMENT_VERSION,
      segments: segments as ComposerClipboardSegment[]
    }
  } catch {
    return null
  }
}

export function readComposerClipboardFragmentFromDataTransfer(
  clipboardData: Pick<DataTransfer, 'getData'> | null | undefined
): ComposerClipboardFragment | null {
  return readComposerClipboardFragment(clipboardData?.getData(COMPOSER_CLIPBOARD_FRAGMENT_MIME) || '')
}

// Session cache: part of this renderer session's restoration context. Holds the
// last rich copy's fragment so pasting that copy restores tokens without ever
// reading the system clipboard. Non-null ⇔ the last rich write put the private
// fragment on the OS clipboard.
let sessionCachedRichClipboardWrite: { plainText: string; fragment: ComposerClipboardFragment } | null = null

// The OS clipboard may convert \n to \r\n on Windows round-trips.
function normalizeClipboardLineEndings(text: string) {
  return text.replace(/\r\n/g, '\n')
}

export function readComposerClipboardFragmentFromSessionCache(pastedText: string): ComposerClipboardFragment | null {
  const cached = sessionCachedRichClipboardWrite
  if (!cached || !pastedText) return null
  return normalizeClipboardLineEndings(pastedText) === cached.plainText ? cached.fragment : null
}

export function writeComposerClipboardData(
  clipboardData: Pick<DataTransfer, 'setData'>,
  content: ComposerRichClipboardContent
) {
  clipboardData.setData('text/plain', content.plainText)
  clipboardData.setData('text/html', content.html)

  for (const [type, value] of Object.entries(content.customFormats ?? {})) {
    clipboardData.setData(type, value)
  }
}

export async function writeComposerRichClipboardContent(content: ComposerRichClipboardContent) {
  sessionCachedRichClipboardWrite = null
  const clipboardItemConstructor = window.ClipboardItem

  if (navigator.clipboard && clipboardItemConstructor) {
    const baseItems: Record<string, Blob> = {
      'text/plain': new Blob([content.plainText], { type: 'text/plain' }),
      'text/html': new Blob([content.html], { type: 'text/html' })
    }
    const customItems = Object.fromEntries(
      Object.entries(content.customFormats ?? {}).flatMap(([type, value]) => {
        const supports = clipboardItemConstructor.supports?.bind(clipboardItemConstructor)
        if (supports && !supports(type)) return []
        return [[type, new Blob([value], { type })]]
      })
    )

    if (Object.keys(customItems).length > 0) {
      try {
        await navigator.clipboard.write([new clipboardItemConstructor({ ...baseItems, ...customItems })])
        const fragment = customItems[COMPOSER_CLIPBOARD_FRAGMENT_MIME]
          ? readComposerClipboardFragment(content.customFormats?.[COMPOSER_CLIPBOARD_FRAGMENT_MIME] ?? '')
          : null
        if (fragment) {
          sessionCachedRichClipboardWrite = { plainText: normalizeClipboardLineEndings(content.plainText), fragment }
        }
        return
      } catch (error) {
        logger.warn('Failed to write composer clipboard custom formats, falling back to text-only data', error as Error)
        await navigator.clipboard.write([new clipboardItemConstructor(baseItems)])
        return
      }
    }

    await navigator.clipboard.write([new clipboardItemConstructor(baseItems)])
    return
  }

  await navigator.clipboard.writeText(content.plainText)
}
