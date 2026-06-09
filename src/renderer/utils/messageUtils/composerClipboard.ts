import { FILE_TYPE, type FileMetadata, type FileType } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { type ComposerMessageToken, readCherryMeta } from '@shared/data/types/uiParts'
import { getFileTypeByExt } from '@shared/file/types'

export const COMPOSER_CLIPBOARD_FRAGMENT_MIME = 'web application/x-cherry-composer-fragment+json'

const COMPOSER_CLIPBOARD_FRAGMENT_VERSION = 1
const COMPOSER_CLIPBOARD_FRAGMENT_MAX_LENGTH = 250_000
const COMPOSER_CLIPBOARD_TOKEN_KINDS = ['skill', 'file', 'knowledge', 'reference', 'quote', 'promptVariable'] as const

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
    path?: string
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
  segments: ComposerClipboardSegment[]
  hasToken: boolean
}

type FileClipboardPayload = NonNullable<ComposerClipboardToken['payload']>
type ClipboardComposerMessageToken = Omit<ComposerMessageToken, 'payload'> & {
  payload?: ComposerClipboardToken['payload']
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

function stripFileUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!value.startsWith('file://')) return value

  try {
    return decodeURIComponent(new URL(value).pathname)
  } catch {
    return value.replace(/^file:\/\//, '')
  }
}

function isFileType(value: unknown): value is FileType {
  return typeof value === 'string' && Object.values(FILE_TYPE).includes(value as FileType)
}

function readFilePayload(payload: unknown): ComposerClipboardToken['payload'] | undefined {
  if (!isRecord(payload)) return undefined

  const result: NonNullable<ComposerClipboardToken['payload']> = {}
  const type = readString(payload.type)
  const ext = readString(payload.ext)
  const name = readString(payload.name)
  const originName = readString(payload.origin_name)
  // Kept only inside the private fragment so an internally-copied message can
  // re-attach the file on paste. The path never reaches html/plain text.
  const path = readString(payload.path)

  if (type) result.type = type
  if (ext) result.ext = ext
  if (name) result.name = name
  if (originName) result.origin_name = originName
  if (typeof payload.size === 'number') result.size = payload.size
  if (path) result.path = path

  return Object.keys(result).length > 0 ? result : undefined
}

function isComposerClipboardTokenKind(value: unknown): value is ComposerClipboardTokenKind {
  return typeof value === 'string' && COMPOSER_CLIPBOARD_TOKEN_KINDS.includes(value as ComposerClipboardTokenKind)
}

function hasUnsafeComposerClipboardFileTokenId(token: Pick<ComposerClipboardSourceToken, 'id' | 'kind'>) {
  if (token.kind !== 'file') return false

  const id = token.id.startsWith('file:') ? token.id.slice('file:'.length) : token.id
  return id.startsWith('/') || id.startsWith('\\') || id.startsWith('~') || /^[A-Za-z]:[\\/]/.test(id)
}

function isUnsafeComposerClipboardFileToken(token: unknown) {
  if (!isRecord(token)) return false

  const id = readString(token.id)
  return Boolean(id && token.kind === 'file' && hasUnsafeComposerClipboardFileTokenId({ id, kind: 'file' }))
}

export function isComposerClipboardToken<T extends Pick<ComposerClipboardSourceToken, 'id' | 'kind'>>(
  token: T
): token is T & { kind: ComposerClipboardToken['kind'] } {
  return isComposerClipboardTokenKind(token.kind) && !hasUnsafeComposerClipboardFileTokenId(token)
}

export function escapeComposerClipboardHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function createComposerClipboardInlineTextHtml(text: string): string {
  return escapeComposerClipboardHtmlText(text).replace(/\r\n?|\n/g, '<br>')
}

export function createComposerClipboardParagraphHtml(inlineHtml: string): string {
  return `<p>${inlineHtml || '<br>'}</p>`
}

export function createComposerClipboardTextHtml(text: string): string {
  return createComposerClipboardParagraphHtml(createComposerClipboardInlineTextHtml(text))
}

function sanitizeComposerClipboardToken(token: unknown): ComposerClipboardToken | null {
  if (!isRecord(token)) return null

  const id = readString(token.id)
  const kind = token.kind
  const label = readString(token.label)
  if (!id || !isComposerClipboardTokenKind(kind) || !label) return null
  if (hasUnsafeComposerClipboardFileTokenId({ id, kind })) return null

  const description = readString(token.description)
  const promptText = readString(token.promptText)
  const payload = kind === 'file' ? readFilePayload(token.payload) : undefined

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

  const token = sanitizeComposerClipboardToken(segment.token)
  if (!token) {
    return isUnsafeComposerClipboardFileToken(segment.token) ? { type: 'text', text: fallbackText } : null
  }

  return { type: 'token', token, fallbackText }
}

export function createComposerClipboardFragment(
  segments: readonly (
    | { type: 'text'; text: string }
    | {
        type: 'token'
        token: ComposerClipboardSourceToken
        fallbackText: string
      }
  )[]
): string {
  const safeSegments = segments.flatMap((segment): ComposerClipboardSegment[] => {
    if (segment.type === 'text') return segment.text ? [{ type: 'text', text: segment.text }] : []

    const token = sanitizeComposerClipboardToken(segment.token)
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
  const path = stripFileUrl(filePart.url)
  if (!path) return undefined

  const name = filePart.filename || path.split(/[\\/]/).pop() || ''
  const ext = getFileExtensionFromName(name)
  return {
    type: filePart.mediaType?.startsWith('image/') ? FILE_TYPE.IMAGE : getFileTypeByExt(ext),
    ...(ext && { ext }),
    ...(name && { name, origin_name: name }),
    path
  }
}

function collectFilePayloadsByName(parts: readonly CherryMessagePart[]): Map<string, FileClipboardPayload> {
  const payloads = new Map<string, FileClipboardPayload>()

  for (const part of parts) {
    const payload = readMessageFilePayload(part)
    if (!payload) continue

    for (const key of [payload.name, payload.origin_name].filter((value): value is string => Boolean(value))) {
      payloads.set(key, payload)
    }
  }

  return payloads
}

function mergeFileTokenPayload(
  token: ComposerMessageToken,
  filePayloadsByName: ReadonlyMap<string, FileClipboardPayload>
): ClipboardComposerMessageToken {
  if (token.kind !== 'file') return token

  const tokenPayload = isRecord(token.payload) ? token.payload : {}
  const matchingFilePayload =
    filePayloadsByName.get(token.label) ||
    filePayloadsByName.get(readString(tokenPayload.name) ?? '') ||
    filePayloadsByName.get(readString(tokenPayload.origin_name) ?? '')

  if (!matchingFilePayload) return token

  return {
    ...token,
    payload: {
      ...matchingFilePayload,
      ...tokenPayload,
      path: readString(tokenPayload.path) ?? matchingFilePayload.path
    }
  } satisfies ClipboardComposerMessageToken
}

function appendTextSegment(segments: ComposerClipboardSegment[], text: string) {
  if (!text) return
  const last = segments[segments.length - 1]
  if (last?.type === 'text') {
    last.text += text
    return
  }
  segments.push({ type: 'text', text })
}

function appendTokenSegment(
  segments: ComposerClipboardSegment[],
  token: ComposerClipboardSourceToken,
  fallbackText: string
): boolean {
  if (!isComposerClipboardToken(token)) {
    appendTextSegment(segments, fallbackText)
    return Boolean(fallbackText)
  }

  const safeFragment = readComposerClipboardFragment(
    createComposerClipboardFragment([{ type: 'token', token, fallbackText }])
  )
  const segment = safeFragment?.segments[0]
  if (!segment) return false
  segments.push(segment)
  return true
}

function projectTextPartToClipboardSegments(
  part: Extract<CherryMessagePart, { type: 'text' }>,
  filePayloadsByName: ReadonlyMap<string, FileClipboardPayload>
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
    .map((token) => mergeFileTokenPayload(token, filePayloadsByName))
  const segments: ComposerClipboardSegment[] = []
  let plainText = ''
  let cursor = 0
  let hasToken = false

  for (const token of tokens) {
    const offset = Math.max(cursor, Math.min(part.text.length, token.textOffset))
    if (offset > cursor) {
      const text = part.text.slice(cursor, offset)
      plainText += text
      appendTextSegment(segments, text)
      cursor = offset
    }

    const fallbackText = getTokenFallbackText(token)
    plainText += fallbackText
    hasToken = appendTokenSegment(segments, token, fallbackText) || hasToken

    if (token.promptText && part.text.slice(offset, offset + token.promptText.length) === token.promptText) {
      cursor = Math.max(cursor, offset + token.promptText.length)
    }
  }

  if (cursor < part.text.length) {
    const text = part.text.slice(cursor)
    plainText += text
    appendTextSegment(segments, text)
  }

  return { plainText, segments, hasToken }
}

function projectComposerClipboardPartGroup(parts: readonly CherryMessagePart[]): ComposerClipboardProjection {
  const filePayloadsByName = collectFilePayloadsByName(parts)
  const projections = parts
    .filter((part): part is Extract<CherryMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => projectTextPartToClipboardSegments(part, filePayloadsByName))
    .filter((projection) => projection.plainText.trim().length > 0)

  const segments: ComposerClipboardSegment[] = []
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
  const segments: ComposerClipboardSegment[] = []
  let plainText = ''
  let cursor = 0
  let hasToken = false

  for (const token of tokens) {
    const offset = Math.max(cursor, Math.min(draft.text.length, token.textOffset))
    if (offset > cursor) {
      const text = draft.text.slice(cursor, offset)
      plainText += text
      appendTextSegment(segments, text)
      cursor = offset
    }

    const fallbackText = getTokenFallbackText(token)
    plainText += fallbackText
    hasToken = appendTokenSegment(segments, token, fallbackText) || hasToken

    if (token.promptText && draft.text.slice(offset, offset + token.promptText.length) === token.promptText) {
      cursor = Math.max(cursor, offset + token.promptText.length)
    }
  }

  if (cursor < draft.text.length) {
    const text = draft.text.slice(cursor)
    plainText += text
    appendTextSegment(segments, text)
  }

  return { plainText, segments, hasToken }
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
  const segments: ComposerClipboardSegment[] = []

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

export function createFileMetadataFromComposerClipboardToken(token: ComposerClipboardToken): FileMetadata | null {
  if (token.kind !== 'file' || !token.payload?.path) return null

  const rawId = token.id.startsWith('file:') ? token.id.slice('file:'.length) : token.id
  if (!rawId) return null

  const name = token.payload.name || token.payload.origin_name || token.label
  const ext = token.payload.ext || getFileExtensionFromName(name)
  const type = isFileType(token.payload.type) ? token.payload.type : getFileTypeByExt(ext)

  return {
    id: rawId,
    name,
    origin_name: token.payload.origin_name || name,
    path: stripFileUrl(token.payload.path) ?? token.payload.path,
    size: token.payload.size ?? 0,
    ext,
    type,
    created_at: '',
    count: 1
  }
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

export async function readComposerClipboardFragmentFromSystemClipboard(): Promise<ComposerClipboardFragment | null> {
  const readClipboard = navigator.clipboard?.read?.bind(navigator.clipboard)
  if (!readClipboard) return null

  try {
    const items = await readClipboard()
    for (const item of items) {
      if (!item.types.includes(COMPOSER_CLIPBOARD_FRAGMENT_MIME)) continue

      const blob = await item.getType(COMPOSER_CLIPBOARD_FRAGMENT_MIME)
      return readComposerClipboardFragment(await blob.text())
    }
  } catch {
    return null
  }

  return null
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
        return
      } catch {
        await navigator.clipboard.write([new clipboardItemConstructor(baseItems)])
        return
      }
    }

    await navigator.clipboard.write([new clipboardItemConstructor(baseItems)])
    return
  }

  await navigator.clipboard.writeText(content.plainText)
}
