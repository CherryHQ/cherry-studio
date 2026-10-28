/**
 * Per-dialect audio/video token cost. The sibling of `imageTokens.ts`: where an image is
 * priced by its pixels, audio and video are priced by their **duration** — every provider
 * that accepts them bills per second (audio) or per sampled frame (video), never by
 * payload size. When the duration is known the per-dialect rate applies; otherwise a
 * bounded fallback duration keeps the estimate finite and in the right order of magnitude.
 *
 * Sizing media by its base64 length is exactly the #17837 bug: a 13 MB MP3 is ~18 M base64
 * characters, which a text tokenizer scores at ~3.7 M tokens against the provider's real
 * 20 k — a ~183x overcount that fired compaction on the very first turn. Nothing here ever
 * looks at the payload bytes.
 */

export type MediaKind = 'audio' | 'video'

/** Tokens per second, per modality. */
export interface MediaRates {
  audio: number
  video: number
}

export type MediaTokensFn = (kind: MediaKind, durationSec?: number) => number

/**
 * Assumed duration when the real one can't be read (remote URL, unreadable bytes, or no
 * probe available on this platform). Deliberately coarse: this is a floor-not-a-guess that
 * keeps a media attachment from being scored as ~0, and the next provider response replaces
 * it with the authoritative `usage` anchor anyway. Erring small is safe here — the
 * alternative (assuming a long file) would fire compaction that the real count doesn't
 * justify, which is the failure this module exists to prevent.
 */
const FALLBACK_SECONDS: MediaRates = { audio: 60, video: 40 }

function ratesToFn(rates: MediaRates): MediaTokensFn {
  return (kind, durationSec) => {
    const seconds =
      durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0
        ? durationSec
        : FALLBACK_SECONDS[kind]
    return Math.ceil(seconds * rates[kind])
  }
}

/**
 * Gemini: audio is billed at a documented **32 tokens/second**; video is sampled at 1 fps
 * and each frame costs the same 258 tokens as an image, so ~258 tokens/second.
 *
 * The audio rate is corroborated by the #17837 report: 20,221 provider tokens / 32 ≈ 632 s
 * ≈ 10.5 min, which matches a 13.6 MB MP3 at ~173 kbps.
 */
export const geminiMediaTokens: MediaTokensFn = ratesToFn({ audio: 32, video: 258 })

/**
 * OpenAI: video frames are sampled (~2 fps) and each low-fidelity frame costs 85 tokens,
 * so ~170 tokens/second.
 *
 * The audio rate is NOT verified against public documentation — it reuses Gemini's 32/s as
 * a same-order approximation, which is far closer than ignoring a known duration. Audio to
 * an openai-dialect model is also rare in practice (see `resolveNativeFileSupport`), and
 * any real request corrects this from the provider's own `usage`.
 * TODO: replace with the documented rate once confirmed.
 */
export const openaiMediaTokens: MediaTokensFn = ratesToFn({ audio: 32, video: 170 })

/**
 * Anthropic accepts neither audio nor video input, so this branch is defensive only —
 * `stripUnsupportedMedia` turns both into a text note long before they reach a Claude wire.
 * Kept on the same rate shape so a future capability needs no new code path.
 */
export const anthropicMediaTokens: MediaTokensFn = ratesToFn({ audio: 32, video: 258 })

/** Ollama: no public per-second scheme → same shape, conservative rates. */
export const ollamaMediaTokens: MediaTokensFn = ratesToFn({ audio: 32, video: 258 })
