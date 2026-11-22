/**
 * Capability-driven multi-image limits for Agent runtimes.
 *
 * Agent requests containing multiple images fail upstream with errors like
 * `At most 1 image(s) may be provided in one prompt` when the selected
 * runtime/provider/model cannot handle them. Chat can always attach images
 * (native vision input or the OCR fallback in `attachmentRouting`), but Agent
 * turns forward attachments through runtime-specific channels — Pi/Durable as
 * absolute file paths the agent reads with its tools, Claude Code as native
 * Anthropic image blocks — so every attached image must be counted in the
 * user's order and checked against what the turn's model accepts, BEFORE a
 * paid provider request is sent.
 *
 * This module is presentation-free and shared by main and renderer:
 * - `isAgentImagePart` / `countAgentImageFileParts` /
 *   `countAgentImageAttachments` — one image definition for message parts,
 *   runtime payloads and composer attachments, so ordering and counts agree
 *   on every surface.
 * - `countRoutedAgentImageFileParts` / `assertRoutedAgentImageLimit` — routed
 *   count that ignores orphaned managed parts (saved history files whose
 *   composer tokens are absent), matching what `prepareChatMessages` would
 *   actually send. History-inclusive gates use this so a text-only
 *   continuation with only orphaned history passes.
 * - `resolveMaxAgentImages` — the capability-driven limit from the production
 *   `Model` contract (`Model.maxAgentImages`): explicit per-model declarations
 *   win, vision models without one are unlimited, and non-vision models defer
 *   to the existing graceful fallbacks (OCR text, path references, Read
 *   guards) instead of a new upfront block. The bundled provider-registry
 *   catalog declares no caps today, so with bundled data every vision model is
 *   unlimited and preflight is a no-op — enforcement activates only when a
 *   deployment declares a cap or an upstream rejection names one.
 * - `assertAgentImageLimit` — throws `AgentImageLimitError` (carrying the
 *   actual limit and count) before the provider call. Callers keep the draft
 *   and history intact so retry preserves attachments and instructions.
 * - `parseUpstreamImageLimit` / `normalizeAgentImageLimitFailure` — turn a
 *   provider rejection that already happened into the same error shape, so
 *   mid-turn tool-read images (which Pi only discovers lazily) still surface
 *   the actual limit instead of a raw wire message. Result-boundary failures
 *   normalize with `sent: true` so surfaces show the request was already sent.
 */

import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { imageExts as sharedImageExts } from '@shared/utils/file'
import { isVisionModel } from '@shared/utils/model'

/**
 * Image extensions counted for Agent multi-image limits (#20030).
 *
 * Deliberately separate from the shared `imageExts` routing table: global
 * `imageExts` drives `getFileTypeByExt` → `attachmentRouting` (IMAGE vs OTHER)
 * and the non-vision OCR fallback. Expanding the global list would reroute
 * AVIF/HEIC/TIFF attachments into OCR and abort turns that previously kept a
 * local-path fallback (notably the built-in Claude Code assistant with a
 * non-vision model and a textless managed AVIF). Counting must stay
 * MIME-aware and forward-compatible, so the Agent guard uses this superset
 * while routing stays untouched.
 */
export const AGENT_IMAGE_EXTS: readonly string[] = [...sharedImageExts, '.avif', '.heic', '.heif', '.tif', '.tiff']

/** Structural subset read by the image predicate. Covers `FileUIPart`,
 *  `CherryMessagePart` file parts and renderer `ComposerAttachment`s. */
export interface AgentImagePartLike {
  readonly mediaType?: string | null
  readonly filename?: string | null
  /** Display name (composer attachments carry `name`/`origin_name`). */
  readonly name?: string | null
  readonly url?: string | null
  /** File extension with leading dot (composer attachments). */
  readonly ext?: string | null
  /**
   * Discriminator: `'file'` for message parts, `FILE_TYPE` (`'image'`, …) for
   * composer attachments.
   */
  readonly type?: string | null
}

function normalizedLower(value: unknown): string | undefined {
  return typeof value === 'string' ? value.toLowerCase() : undefined
}

function dataUrlImageMediaType(url: string): string | undefined {
  if (!url.startsWith('data:')) return undefined
  const comma = url.indexOf(',')
  const header = (comma === -1 ? url.slice(5) : url.slice(5, comma)).split(';', 1)[0]?.trim()
  return header?.toLowerCase().startsWith('image/') ? header : undefined
}

function urlPath(url: string): string {
  return (url.split(/[?#]/, 1)[0] ?? '').toLowerCase()
}

/**
 * Whether the part carries image bytes: a declared image media type, an image
 * data URL, a composer `FILE_TYPE.IMAGE` marker, or a known image extension on
 * the extension, filename or (non-data) URL — in first-occurrence order, so
 * every surface counts the same parts.
 *
 * Uses `AGENT_IMAGE_EXTS` (shared routing table plus AVIF/HEIC/TIFF) so
 * renderer attachments without MIME agree with main's MIME-aware count after
 * the file bridge. This counting list never alters `getFileTypeByExt`
 * routing.
 */
export function isAgentImagePart(part: AgentImagePartLike | null | undefined): boolean {
  if (!part || typeof part !== 'object') return false
  if (normalizedLower(part.mediaType)?.startsWith('image/')) return true
  // Composer attachments discriminate by FILE_TYPE; message parts use 'file'.
  if (normalizedLower(part.type) === 'image') return true
  if (typeof part.url === 'string' && dataUrlImageMediaType(part.url) !== undefined) return true
  const ext = normalizedLower(part.ext)
  if (ext && AGENT_IMAGE_EXTS.includes(ext)) return true
  const filename = normalizedLower(part.filename)
  const name = normalizedLower(part.name)
  const path = typeof part.url === 'string' && !part.url.startsWith('data:') ? urlPath(part.url) : undefined
  return AGENT_IMAGE_EXTS.some(
    (extension) => filename?.endsWith(extension) || name?.endsWith(extension) || path?.endsWith(extension)
  )
}

/**
 * Count image `file` parts in input order (message/runtime payloads). Only
 * `type === 'file'` parts can carry image bytes; text and tool parts never
 * count.
 */
export function countAgentImageFileParts(parts: readonly unknown[] | undefined | null): number {
  if (!parts) return 0
  let count = 0
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const candidate = part as AgentImagePartLike
    if (candidate.type !== 'file') continue
    if (isAgentImagePart(candidate)) count += 1
  }
  return count
}

/**
 * Collect active composer file-token ids from text parts.
 *
 * Mirrors `collectComposerFileTokenIds` in attachment routing: a managed file
 * part is only routed when its `fileTokenSourceId` still has a live composer
 * token. History replay carries saved file parts without their original tokens,
 * so counting them raw would reject a text-only continuation that routing
 * would send with zero images.
 */
export function collectActiveAgentFileTokenIds(parts: readonly unknown[] | undefined | null): Set<string> {
  const ids = new Set<string>()
  if (!parts) return ids
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const candidate = part as { type?: unknown }
    if (candidate.type !== 'text') continue
    const meta = readCherryMeta(candidate as CherryMessagePart) as { composer?: { tokens?: unknown } } | undefined
    const tokens = meta?.composer?.tokens
    if (!Array.isArray(tokens)) continue
    for (const token of tokens) {
      if (typeof token !== 'object' || token === null) continue
      const entry = token as { kind?: unknown; id?: unknown }
      if (entry.kind === 'file' && typeof entry.id === 'string') ids.add(entry.id)
    }
  }
  return ids
}

/**
 * Whether the part would survive attachment routing and reach the model.
 * Orphaned managed parts (a `fileTokenSourceId` with no live `file:` token)
 * are dropped by `prepareChatMessages` before native blocks or path fallbacks
 * are built, so pre-send admission must not count them.
 *
 * Workspace/external parts carry no `fileEntryId` (accessible-path `file://`
 * refs, gateway/legacy parts): routing keeps them as file parts and Agent
 * runtimes forward them via local paths, so they are always routed even when
 * their composer token is absent from a replay wrapper.
 */
export function isRoutedAgentImagePart(
  part: AgentImagePartLike | null | undefined,
  activeTokenIds?: ReadonlySet<string>
): boolean {
  if (!isAgentImagePart(part)) return false
  if (!part || typeof part !== 'object') return false
  const meta = readCherryMeta(part as CherryMessagePart) as
    | {
        fileTokenSourceId?: unknown
        fileEntryId?: unknown
      }
    | undefined
  const sourceId = typeof meta?.fileTokenSourceId === 'string' ? meta.fileTokenSourceId : undefined
  if (!sourceId) return true
  // External/workspace refs have no managed entry to orphan: Pi forwards every
  // `file://` path and Claude counts them as external native candidates.
  if (typeof meta?.fileEntryId !== 'string' || !meta.fileEntryId) return true
  if (!activeTokenIds) return true
  return activeTokenIds.has(`file:${sourceId}`)
}

/**
 * Count only routed image `file` parts: orphaned managed parts are ignored,
 * matching what `prepareChatMessages` would actually send.
 */
export function countRoutedAgentImageFileParts(parts: readonly unknown[] | undefined | null): number {
  if (!parts) return 0
  const tokenIds = collectActiveAgentFileTokenIds(parts)
  let count = 0
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const candidate = part as AgentImagePartLike
    if (candidate.type !== 'file') continue
    if (isRoutedAgentImagePart(candidate, tokenIds)) count += 1
  }
  return count
}

/** Count image attachments in order (composer attachments are file-only). */
export function countAgentImageAttachments(attachments: readonly AgentImagePartLike[] | undefined | null): number {
  if (!attachments) return 0
  return attachments.filter(isAgentImagePart).length
}

export interface AgentImageLimitDetails {
  /** Maximum images the turn's model accepts in one Agent request. */
  limit: number
  /** Attached image count, in the user's order. */
  count: number
  /** Runtime that enforced the limit (`pi`, `pi-durable`, `claude-code`). */
  runtime?: string
  /** True when the provider already received the request (result boundary). */
  sent?: boolean
}

/**
 * Thrown when the attached images exceed what the turn's model accepts.
 * Pre-send guards throw with `sent: false` (nothing was sent, drafts stay
 * intact); provider result failures normalize with `sent: true` so surfaces
 * show that the request was already sent.
 */
export class AgentImageLimitError extends Error {
  readonly limit: number
  readonly count: number
  readonly runtime?: string
  readonly sent: boolean
  /** ErrorBlock renders `error.agent_image_limit_exceeded(_after_send)` + the detail line. */
  readonly i18nKey: 'agent_image_limit_exceeded' | 'agent_image_limit_exceeded_after_send'
  readonly detailI18nKey = 'agent_image_limit_detail' as const
  readonly detailI18nValues: Record<string, string>
  /** Classifier ownership: a count-limit rejection is never auth/quota/mcp. */
  readonly providerErrorCategory = 'bad_request' as const

  constructor(details: AgentImageLimitDetails, message?: string) {
    const sent = details.sent === true
    super(
      message ??
        (sent
          ? `This Agent request sent ${details.count} image(s), but the provider allows at most ${details.limit} image(s) in one prompt.`
          : `This Agent request attaches ${details.count} image(s), but the selected model accepts at most ${details.limit} image(s) in one prompt.`)
    )
    this.name = 'AgentImageLimitError'
    this.limit = details.limit
    this.count = details.count
    this.runtime = details.runtime
    this.sent = sent
    this.i18nKey = sent ? 'agent_image_limit_exceeded_after_send' : 'agent_image_limit_exceeded'
    this.detailI18nValues = { limit: String(details.limit), count: String(details.count) }
  }
}

/**
 * Capability-driven limit for one Agent request. Explicit per-model
 * declarations (`maxAgentImages` on the production `Model` contract) win.
 * Vision models without one are unlimited — supported models receive every
 * image in the user's order. Non-vision models return `undefined` (no upfront
 * block): their graceful fallbacks (OCR text, path references, Read guards)
 * already apply.
 */
export function resolveMaxAgentImages(model: Model | undefined | null): number | undefined {
  if (!model || !isVisionModel(model)) return undefined
  const declared = model.maxAgentImages
  if (typeof declared === 'number' && Number.isFinite(declared) && declared >= 0) {
    return Math.floor(declared)
  }
  return undefined
}

/**
 * Throw `AgentImageLimitError` when the parts exceed the turn model's limit.
 * A no-op while the limit is unknown (unlimited) — supported combinations
 * pass through untouched.
 */
export function assertAgentImageLimit(
  parts: readonly unknown[] | undefined | null,
  model: Model | undefined | null,
  opts?: { runtime?: string; maxImages?: number }
): void {
  const limit = opts?.maxImages ?? resolveMaxAgentImages(model)
  if (limit === undefined) return
  const count = countAgentImageFileParts(parts)
  if (count > limit) throw new AgentImageLimitError({ limit, count, runtime: opts?.runtime })
}

/**
 * Throw `AgentImageLimitError` when the *routed* image count exceeds the
 * turn model's limit. Unlike `assertAgentImageLimit` (raw structural count),
 * orphaned managed parts — saved history files whose composer tokens are
 * absent from the replay wrapper — are ignored, matching what
 * `prepareChatMessages` would actually send. A text-only continuation with
 * only orphaned history therefore passes, while two actually routed images
 * still fail before the paid call.
 *
 * Workspace/external refs (no `fileEntryId`) are always routed: Pi forwards
 * every `file://` path and Claude counts them as external native candidates,
 * so replayed workspace PNGs gate even without live tokens.
 */
export function assertRoutedAgentImageLimit(
  parts: readonly unknown[] | undefined | null,
  model: Model | undefined | null,
  opts?: { runtime?: string; maxImages?: number }
): void {
  const limit = opts?.maxImages ?? resolveMaxAgentImages(model)
  if (limit === undefined) return
  const count = countRoutedAgentImageFileParts(parts)
  if (count > limit) throw new AgentImageLimitError({ limit, count, runtime: opts?.runtime })
}

/**
 * Claude native-block media mapping. Mirrors the runtime driver's
 * `toClaudeImageMediaType`: only JPEG/PNG/GIF/WebP can become Anthropic image
 * blocks. Anything else (AVIF, HEIC, TIFF, BMP …) takes the local-path
 * fallback and must not count toward the native image cap.
 *
 * Legacy aliases (`image/x-png`, `image/pjpeg` …) resolve to their canonical
 * types so pre-send admission agrees with managed-file materialization, which
 * reports on-disk MIME (`image/png` for both `image/png` and `image/x-png`
 * labels) before the driver's native-block guard runs.
 */
export function toClaudeNativeMediaType(value: string | undefined | null): string | null {
  switch (value?.toLowerCase()) {
    case 'image/jpg':
    case 'image/jpeg':
    case 'image/pjpeg':
    case 'image/x-jpeg':
      return 'image/jpeg'
    case 'image/png':
    case 'image/x-png':
      return 'image/png'
    case 'image/gif':
    case 'image/x-gif':
      return 'image/gif'
    case 'image/webp':
    case 'image/x-webp':
      return 'image/webp'
    default:
      return null
  }
}

/**
 * Whether the part could become a Claude native image block. Mirrors
 * `canBeClaudeImage` in the Claude Code runtime driver: declared image media
 * types must map to a Claude-supported block type; unknown or
 * `application/octet-stream` defers to materialization (counts) unless the
 * extension identifies a known non-native image (TIFF, AVIF, HEIC, BMP …),
 * which takes the local-path fallback and must not count toward the native
 * cap. Otherwise the filename/URL extension decides among the four natively
 * supported types.
 */
const CLAUDE_NATIVE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'] as const
export function canBeClaudeNativeImagePart(part: AgentImagePartLike | null | undefined): boolean {
  if (!part || typeof part !== 'object') return false
  const url = typeof part.url === 'string' ? part.url : undefined
  const inlineType = url?.startsWith('data:') ? dataUrlImageMediaType(url) : undefined
  const mediaType = (inlineType ?? normalizedLower(part.mediaType))?.toLowerCase()
  const filename = normalizedLower(part.filename) ?? normalizedLower(part.name)
  const ext = normalizedLower(part.ext)
  const path = url && !url.startsWith('data:') ? urlPath(url) : undefined
  if (!mediaType || mediaType === 'application/octet-stream') {
    // Composer attachments carry no MIME (only ext/name); file parts without
    // MIME defer to materialization. A known image extension that is not
    // natively supported (TIFF, AVIF, HEIC, BMP …) still takes the path
    // fallback — exclude it so PNG+TIFF fits a one-image native cap, matching
    // the driver. Unknown extensions (e.g. `.jpe`, which materializes to
    // `image/jpeg`) defer to materialization and count.
    const knownExt =
      ext && AGENT_IMAGE_EXTS.includes(ext)
        ? ext
        : AGENT_IMAGE_EXTS.find((extension) => filename?.endsWith(extension) || path?.endsWith(extension))
    if (knownExt) return (CLAUDE_NATIVE_EXTS as readonly string[]).includes(knownExt)
    return true
  }
  if (mediaType.startsWith('image/')) return toClaudeNativeMediaType(mediaType) !== null
  if (ext && (CLAUDE_NATIVE_EXTS as readonly string[]).includes(ext)) return true
  return (CLAUDE_NATIVE_EXTS as readonly string[]).some(
    (extension) => filename?.endsWith(extension) || path?.endsWith(extension)
  )
}

/**
 * Count the images Claude would actually send as native blocks: routed managed
 * images (with `fileEntryId` + live token) plus external/workspace images (no
 * `fileEntryId`) that can become native blocks. Orphaned managed images are
 * dropped by `prepareChatMessages` and excluded; AVIF/HEIC/TIFF take the
 * path fallback via `canBeClaudeNativeImagePart` and are excluded.
 */
export function countClaudeNativeImageParts(parts: readonly unknown[] | undefined | null): number {
  if (!parts) return 0
  const tokenIds = collectActiveAgentFileTokenIds(parts)
  let count = 0
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const candidate = part as AgentImagePartLike
    if (candidate.type !== 'file') continue
    if (!isRoutedAgentImagePart(candidate, tokenIds)) continue
    if (!canBeClaudeNativeImagePart(candidate)) continue
    count += 1
  }
  return count
}

/**
 * Count composer attachments that would become Claude native image blocks.
 * Renderer attachments carry no MIME (only `ext`/`name`), so this uses the
 * same `isAgentImagePart` + `canBeClaudeNativeImagePart` pair as the driver:
 * TIFF/AVIF/HEIC/BMP take the path fallback and are excluded, while PNG/JPEG
 * count. Unknown extensions (e.g. `.jpe`) defer to materialization and count,
 * matching main's MIME-aware count after the file bridge.
 */
export function countClaudeNativeImageAttachments(
  attachments: readonly AgentImagePartLike[] | undefined | null
): number {
  if (!attachments) return 0
  let count = 0
  for (const attachment of attachments) {
    if (!isAgentImagePart(attachment)) continue
    if (!canBeClaudeNativeImagePart(attachment)) continue
    count += 1
  }
  return count
}

/**
 * Count prebuilt file parts (Desktop Resend) that would become Claude native
 * blocks. Unlike `countClaudeNativeImageParts`, this ignores routed-token
 * state — resend parts are the fresh turn payload, not history replay — and
 * counts `isAgentImagePart` + native eligibility only, matching the driver's
 * fresh-send pre-check.
 */
export function countClaudeNativeFileParts(parts: readonly unknown[] | undefined | null): number {
  if (!parts) return 0
  let count = 0
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const candidate = part as AgentImagePartLike
    if (candidate.type !== 'file') continue
    if (!isAgentImagePart(candidate)) continue
    if (!canBeClaudeNativeImagePart(candidate)) continue
    count += 1
  }
  return count
}

/**
 * Throw when Claude's native image-block count exceeds the turn model's limit.
 * Workspace PNGs replayed without live tokens still count (external refs);
 * orphaned managed history does not (routing drops it); AVIF/HEIC fall back
 * to paths and do not count.
 */
export function assertClaudeAgentImageLimit(
  parts: readonly unknown[] | undefined | null,
  model: Model | undefined | null,
  opts?: { runtime?: string; maxImages?: number }
): void {
  const limit = opts?.maxImages ?? resolveMaxAgentImages(model)
  if (limit === undefined) return
  const count = countClaudeNativeImageParts(parts)
  if (count > limit) throw new AgentImageLimitError({ limit, count, runtime: opts?.runtime ?? 'claude-code' })
}

/**
 * Whether the turn carries a manual `/compact` instruction. Both Pi drivers
 * recognize compaction from the joined prompt text (`buildAgentUserContent`)
 * and return without using the replay payload
 * (`PiRuntimeConnection.send` short-circuits on `parseManualCompactCommand`,
 * `PiDurableRuntimeConnection.send` on `isCompactCommand`), so
 * replay-inclusive image gates must not count history for these turns.
 *
 * Mirrors the drivers exactly:
 * - joins all text parts with `\n` (like `extractMessageText`) and tests
 *   `^\/compact(?:\s|$)` on the trimmed result — a second text part of
 *   `/compact` after `Compare these` does NOT match, matching the drivers'
 *   ordinary-turn submission;
 * - `systemReminder` steers never match (drivers check `!systemReminder`);
 * - delivery messages never match (the delivery wrapper prefixes the prompt
 *   with a security notice, so `trimmed` never starts with `/compact`).
 */
export function isManualCompactParts(
  parts: readonly unknown[] | undefined | null,
  opts?: { systemReminder?: boolean; hasDelivery?: boolean }
): boolean {
  if (opts?.systemReminder === true) return false
  if (opts?.hasDelivery === true) return false
  if (!parts) return false
  const texts: string[] = []
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const candidate = part as { type?: unknown; text?: unknown }
    if (candidate.type !== 'text' || typeof candidate.text !== 'string') continue
    texts.push(candidate.text)
  }
  if (texts.length === 0) return false
  return /^\/compact(?:\s|$)/.test(texts.join('\n').trim())
}

/**
 * Runtime-specific pre-send gate for Agent turns.
 *
 * - Pi / Pi-Durable forward every `file://` attachment as a readable path
 *   (`buildAgentUserContent`), regardless of composer tokens — so history
 *   replay must count raw, not routed.
 * - Claude Code sends routed managed images plus external/workspace images as
 *   native blocks — so the Claude-native count applies with or without history.
 * - Other runtimes keep the previous behavior: history-inclusive calls use the
 *   routed count (orphaned managed history passes), fresh sends use raw.
 *
 * Callers skip replay validation for manual `/compact` on Pi / Pi-Durable
 * (see `isManualCompactParts`): both drivers compact without submitting
 * replay when `systemReminder` is false. The gate itself stays
 * system-reminder-agnostic so steers (which the drivers do not treat as
 * compact) keep their existing validation.
 */
export function assertRuntimeAgentImageLimit(
  parts: readonly unknown[] | undefined | null,
  model: Model | undefined | null,
  runtime: string | undefined,
  opts?: { routed?: boolean; maxImages?: number }
): void {
  if (runtime === 'pi' || runtime === 'pi-durable') {
    assertAgentImageLimit(parts, model, { runtime, maxImages: opts?.maxImages })
    return
  }
  if (runtime === 'claude-code') {
    assertClaudeAgentImageLimit(parts, model, { runtime, maxImages: opts?.maxImages })
    return
  }
  if (opts?.routed === true) {
    assertRoutedAgentImageLimit(parts, model, { runtime, maxImages: opts?.maxImages })
    return
  }
  assertAgentImageLimit(parts, model, { runtime, maxImages: opts?.maxImages })
}

/** Extract the limit from an upstream rejection such as
 *  `At most 1 image(s) may be provided in one prompt`. */
export function parseUpstreamImageLimit(message: string | undefined | null): number | undefined {
  if (!message) return undefined
  const match = /at most (\d+) image/i.exec(message)
  if (!match) return undefined
  const limit = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(limit) && limit >= 0 ? limit : undefined
}

/**
 * Convert a provider rejection into `AgentImageLimitError` when its text
 * names an image limit the attached count exceeds. Returns `undefined` for
 * anything else so unrelated failures keep their own presentation. Pass
 * `sent: true` at the provider result boundary (the request was already
 * sent); pre-send admission rejections keep the default unsent wording.
 */
export function normalizeAgentImageLimitFailure(
  error: unknown,
  count: number,
  opts?: { runtime?: string; sent?: boolean }
): AgentImageLimitError | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
  const limit = parseUpstreamImageLimit(message)
  if (limit === undefined || count <= limit) return undefined
  const sent = opts?.sent === true
  // Preserve the upstream text for unsent admission rejections; for sent
  // result failures use the sent-aware default so surfaces do not claim
  // that nothing was sent.
  if (sent) return new AgentImageLimitError({ limit, count, runtime: opts?.runtime, sent: true })
  return new AgentImageLimitError({ limit, count, runtime: opts?.runtime }, message ?? undefined)
}
