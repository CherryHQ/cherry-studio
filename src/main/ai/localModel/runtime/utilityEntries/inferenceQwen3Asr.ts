import type { Qwen3AsrModel, Qwen3AsrResult, Qwen3AsrStream } from '@cherrystudio/mlx-asr'
import type { AsrSegment, AsrTranscribePayload } from '@main/ai/localModel/capabilities/asr/protocol'
import type { UtilityProcessStreamHandlers } from '@main/core/utilityProcess/runtime/serveUtilityProcess'
import type { UtilityProcessHandlerContext } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import type { AsrInferenceContract } from '../inferenceProcess'
import { getMlxAsr } from './inferenceRuntime'

// Model switches and cancellation terminate the owning process; the native API has no dispose method.
let cached: Promise<Qwen3AsrModel> | undefined

export async function transcribeQwen3Asr(
  { modelDir, source }: Extract<AsrTranscribePayload, { engine: 'mlx' }>,
  { signal }: UtilityProcessHandlerContext<never>
): Promise<{ text: string; segments: AsrSegment[] }> {
  signal.throwIfAborted()
  if (source.sampleRate !== 16_000 || !source.samples.length || !source.samples.every(Number.isFinite))
    throw Object.assign(new Error('Invalid ASR PCM'), { code: 'VOICE_AUDIO_INVALID' })
  const model = await loadModel(modelDir)
  signal.throwIfAborted()
  const result = await model.transcribe(source.samples, { sampleRate: source.sampleRate, maxTokens: 4096 })
  signal.throwIfAborted()
  if (result.reachedMaxTokens || !result.isFinal) throw new Error('ASR output was truncated')
  return { text: result.text.trim(), segments: [] }
}

function loadModel(modelDir: string): Promise<Qwen3AsrModel> {
  cached ??= (async () => {
    try {
      const runtime = await getMlxAsr()
      return await runtime.Qwen3AsrModel.load(modelDir)
    } catch (cause) {
      cached = undefined
      throw Object.assign(new Error('ASR model initialization failed', { cause }), { code: 'ASR_MODEL_LOAD_FAILED' })
    }
  })()
  return cached
}

export const asrStreamHandlers: UtilityProcessStreamHandlers<AsrInferenceContract> = {
  async transcribe({ modelDir, sampleRate }, { input, signal, write, logger }) {
    if (sampleRate !== 16000) throw new Error('Invalid ASR sample rate')
    const model = await loadModel(modelDir)
    signal.throwIfAborted()
    let stream: Qwen3AsrStream | undefined
    let finished = false
    await write({ metadata: { type: 'ready' } })
    let frames = 0
    const publish = async (result: Qwen3AsrResult) => {
      if (result.reachedMaxTokens) throw new Error('ASR output was truncated')
      await write({
        metadata: {
          type: 'revision',
          revision: result.revision,
          text: result.text,
          provisionalStart: result.text.startsWith(result.stableText) ? result.stableText.length : 0,
          final: result.isFinal
        }
      })
    }
    try {
      for await (const chunk of input) {
        signal.throwIfAborted()
        if (
          chunk.metadata.startFrame !== frames ||
          chunk.payload.byteLength % 4 ||
          !chunk.payload.byteLength ||
          chunk.payload.byteLength > 6400
        )
          throw new Error('Invalid ASR PCM sequence')
        const samples = new Float32Array(chunk.payload.slice().buffer)
        if (!samples.every(Number.isFinite) || frames + samples.length > sampleRate * 300)
          throw new Error('Invalid ASR PCM')
        frames += samples.length
        stream ??= await model.createStream({ sampleRate, chunkSeconds: 2 })
        const result = await stream.feed(samples)
        signal.throwIfAborted()
        if (result) await publish(result)
      }
      signal.throwIfAborted()
      if (!stream) return { text: '' }
      const result = await stream.finish()
      finished = true
      signal.throwIfAborted()
      if (!result.isFinal) throw new Error('ASR did not finalize')
      await publish(result)
      return { text: result.text.trim() }
    } finally {
      if (stream && !finished && !signal.aborted) {
        try {
          await stream.finish()
        } catch {
          // Native streams have no dispose API; exit rather than acknowledge cleanup of a retained stream.
          logger.error('ASR stream cleanup failed')
          process.exit(1)
        }
      }
    }
  }
}
