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
 * - `resolveMaxAgentImages` — the capability-driven limit from the production
 *   `Model` contract (`Model.maxAgentImages`): explicit per-model declarations
 *   win, vision models without one are unlimited, and non-vision models defer
 *   to the existing graceful fallbacks (OCR text, path references, Read
 *   guards) instead of a new upfront block.
 * - `assertAgentImageLimit` — throws `AgentImageLimitError` (carrying the
 *   actual limit and count) before the provider call. Callers keep the draft
 *   and history intact so retry preserves attachments and instructions.
 * - `parseUpstreamImageLimit` / `normalizeAgentImageLimitFailure` — turn a
 *   provider rejection that already happened into the same error shape, so
 *   mid-turn tool-read images (which Pi only discovers lazily) still surface
 *   the actual limit instead of a raw wire message. Result-boundary failures
 *   normalize with `sent: true` so surfaces show the request was already sent.
 */

import type { Model } from '@shared/data/types/model'
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
