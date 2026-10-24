import { open } from 'node:fs/promises'

import type { FunAsrModelPaths } from '@main/ai/localModel/capabilities/asr/protocol'

export const FUNASR_ASR_SAMPLE_RATE = 16_000

/**
 * sherpa-onnx FeatureConfig frame shift. The recognizer is built without
 * overriding it, so this matches the fbank framing the model sees.
 */
const FEATURE_FRAME_SHIFT_MS = 10

/**
 * Encoded chat template around the audio placeholders (default system prompt
 * plus the "语音转写：" user turn) measures ~20 tokens. Hotwords or a language
 * hint would grow the prompt, so budget a conservative ceiling instead.
 */
const PROMPT_TOKEN_OVERHEAD = 32

/**
 * Generated text shares the decoder's KV window with the prompt and the audio
 * tokens: the FunASR Nano generation loop breaks silently once
 * `valid_len >= max_total_len`, so a chunk that spends too much of the window
 * on audio loses the tail of its transcript without any error. The reserve is
 * what actually protects the transcript — audio is capped so this much room
 * always remains for the generated text.
 */
const OUTPUT_TOKEN_RESERVE = 256

/**
 * Documented fallbacks matching the pinned int8 artifacts
 * (csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30): llm.onnx metadata
 * `max_total_len=512`, encoder metadata `lfr_window_shift=6`.
 */
const FALLBACK_MAX_TOTAL_LEN = 512
const FALLBACK_LFR_WINDOW_SHIFT = 6

/**
 * ONNX serializes metadata_props after the graph, so the custom metadata map
 * sits within the last kilobytes of the file.
 */
const METADATA_TAIL_BYTES = 64 * 1024

export interface FunAsrNanoLimits {
  /** KV window of the LLM decoder: prompt + audio tokens + generated text must fit. */
  maxTotalLen: number
  /** PCM samples per audio token (LFR shift × frame shift at the recognizer rate). */
  samplesPerAudioToken: number
  /** True when a metadata value was unreadable and the documented fallback was used. */
  usedFallback: boolean
}

interface MetadataRange {
  min: number
  max: number
}

function readVarint(bytes: Uint8Array, start: number): { value: number; end: number } | undefined {
  let value = 0
  let shift = 1
  for (let cursor = start; cursor < bytes.length; cursor += 1) {
    const byte = bytes[cursor]
    value += (byte & 0x7f) * shift
    if ((byte & 0x80) === 0) return { value, end: cursor + 1 }
    shift *= 128
    if (shift > 2 ** 28) return undefined
  }
  return undefined
}

/**
 * Reads an integer entry of the ONNX custom metadata map from the tail bytes
 * of a model file: the value follows the key as a
 * StringStringEntryProto `0x12 <varint length> <ascii digits>` field. The last
 * occurrence that validates wins; anything else returns undefined.
 */
export function parseOnnxMetadataInt(tail: Buffer, key: string, range: MetadataRange): number | undefined {
  const keyBytes = Buffer.from(key, 'latin1')
  let valid: number | undefined
  for (let index = tail.indexOf(keyBytes); index !== -1; index = tail.indexOf(keyBytes, index + 1)) {
    if (tail[index + keyBytes.length] !== 0x12) continue
    const length = readVarint(tail, index + keyBytes.length + 1)
    if (!length || length.value === 0 || length.value > 9) continue
    const value = tail.subarray(length.end, length.end + length.value)
    if (value.length !== length.value || !value.every((byte) => byte >= 0x30 && byte <= 0x39)) continue
    const parsed = Number.parseInt(value.toString('latin1'), 10)
    if (parsed >= range.min && parsed <= range.max) valid = parsed
  }
  return valid
}

async function readMetadataTail(filePath: string): Promise<Buffer | undefined> {
  try {
    const handle = await open(filePath, 'r')
    try {
      const { size } = await handle.stat()
      const start = Math.max(0, size - METADATA_TAIL_BYTES)
      const length = size - start
      const tail = Buffer.alloc(length)
      const { bytesRead } = await handle.read(tail, 0, length, start)
      return tail.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

/**
 * Reads the chunking constraints from the downloaded model files so a
 * re-exported artifact with a different KV window is chunked correctly
 * without a code change. Unreadable files or malformed metadata fall back to
 * the documented values of the pinned artifacts.
 */
export async function readFunAsrNanoLimits(
  modelPaths: Pick<FunAsrModelPaths, 'encoder' | 'llm'>
): Promise<FunAsrNanoLimits> {
  const [llmTail, encoderTail] = await Promise.all([
    readMetadataTail(modelPaths.llm),
    readMetadataTail(modelPaths.encoder)
  ])
  const maxTotalLen = llmTail ? parseOnnxMetadataInt(llmTail, 'max_total_len', { min: 64, max: 131_072 }) : undefined
  const lfrWindowShift = encoderTail
    ? parseOnnxMetadataInt(encoderTail, 'lfr_window_shift', { min: 1, max: 16 })
    : undefined
  return {
    maxTotalLen: maxTotalLen ?? FALLBACK_MAX_TOTAL_LEN,
    samplesPerAudioToken: Math.round(
      (FUNASR_ASR_SAMPLE_RATE * FEATURE_FRAME_SHIFT_MS * (lfrWindowShift ?? FALLBACK_LFR_WINDOW_SHIFT)) / 1000
    ),
    usedFallback: maxTotalLen === undefined || lfrWindowShift === undefined
  }
}

/**
 * Largest VAD-segment chunk that still leaves OUTPUT_TOKEN_RESERVE of the KV
 * window for the generated transcript. The pinned artifacts budget
 * 512 − 32 − 256 = 224 audio tokens ≈ 13.4s per chunk, which bounds a full
 * prefill at ~224 audio tokens and keeps several times the expected output
 * (~60 characters for 13s of Mandarin) available for generation.
 */
export function computeFunAsrNanoChunkSamples(limits: FunAsrNanoLimits): number {
  const audioTokenBudget = Math.max(8, limits.maxTotalLen - PROMPT_TOKEN_OVERHEAD - OUTPUT_TOKEN_RESERVE)
  return Math.max(limits.samplesPerAudioToken, audioTokenBudget * limits.samplesPerAudioToken)
}
