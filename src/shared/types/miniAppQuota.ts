/**
 * Deliberately dependency-free, and kept apart from `miniAppManifest.ts` (zod + semver):
 * `@shared/ipc/schemas/miniAppBridge` reads two limits from here and is bundled into the
 * guest PRELOAD, where those two packages would be dead weight in every mini app process.
 */

/** What a capability counts. */
export interface QuotaUsage {
  bytes: number
  count: number
}

/** Usage plus the ceiling it is measured against — the panel draws a bar, not a number. */
export interface QuotaUsageWithLimits extends QuotaUsage {
  bytesLimit: number
  countLimit: number
}

/**
 * Hard ceiling on one call's prompt, measured in UTF-8 BYTES — not characters.
 *
 * `String.length` counts UTF-16 code units, which bounds neither. An emoji is two
 * code units; a CJK character is one code unit but three UTF-8 bytes, and under a
 * byte-level BPE it can cost up to three tokens. Byte length is the bound that
 * actually holds: byte-level tokenizers never emit more tokens than input bytes,
 * because every token maps to at least one byte.
 *
 * Generous on purpose: this is an abuse stop, not a spending budget. The model's own
 * context window is the real ceiling, and overrunning it surfaces as the provider's
 * error — which is the one the app can act on.
 */
export const MINI_APP_MAX_INPUT_BYTES = 256 * 1024

/**
 * Message COUNT cap. Bounding only total bytes still lets ten thousand empty messages
 * through, and each one costs real framing tokens once serialized.
 *
 * Both of these live in `@shared` rather than beside the rest of the AI constants
 * because the guest-side length gate (`MINI_APP_GUEST_LIMITS`) must use the very same
 * numbers, and that gate is shared code — two copies would be no gate at all. And in
 * THIS module rather than the manifest one: the guest preload bundles whatever it
 * imports, and the manifest module drags zod and semver in with it.
 */
export const MINI_APP_MAX_MESSAGES = 64
