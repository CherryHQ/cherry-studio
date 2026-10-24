import { createRequire } from 'node:module'
import { cpus } from 'node:os'
import { join } from 'node:path'

import type { TtsInferenceContract } from '../../capabilities/tts/protocol'

interface KokoroRuntime {
  OfflineTts: {
    createAsync(config: unknown): Promise<{
      generate(request: unknown): { samples: Float32Array; sampleRate: number }
    }>
  }
  writeWave(filename: string, audio: { samples: Float32Array; sampleRate: number }): void
}

export class KokoroTts {
  private readonly runtime: KokoroRuntime
  private model?: Awaited<ReturnType<KokoroRuntime['OfflineTts']['createAsync']>>

  constructor(appPath: string) {
    this.runtime = createRequire(`${appPath}/`)('sherpa-onnx-node')
  }

  async synthesize(input: TtsInferenceContract['methods']['synthesize']['input'], signal: AbortSignal) {
    signal.throwIfAborted()
    if (!this.model) {
      try {
        this.model = await this.runtime.OfflineTts.createAsync({
          model: {
            kokoro: {
              model: join(input.modelDir, 'model.onnx'),
              voices: join(input.modelDir, 'voices.bin'),
              tokens: join(input.modelDir, 'tokens.txt'),
              dataDir: join(input.modelDir, 'espeak-ng-data'),
              lexicon: ['lexicon-us-en.txt', 'lexicon-zh.txt'].map((file) => join(input.modelDir, file)).join(',')
            },
            numThreads: Math.max(2, Math.min(4, cpus().length - 1)),
            provider: 'cpu',
            debug: false
          },
          ruleFsts: ['date-zh.fst', 'number-zh.fst', 'phone-zh.fst']
            .map((file) => join(input.modelDir, file))
            .join(','),
          maxNumSentences: 1
        })
      } catch (cause) {
        throw Object.assign(new Error('Speech model initialization failed', { cause }), {
          code: 'TTS_MODEL_LOAD_FAILED'
        })
      }
    }
    signal.throwIfAborted()
    const requests = input.segments?.length ? input.segments : [{ text: input.text, voice: input.voice }]
    const parts: Float32Array[] = []
    let sampleRate = 0
    for (const request of requests) {
      signal.throwIfAborted()
      const audio = this.model.generate({
        text: request.text,
        sid: Number(request.voice),
        speed: input.speed,
        // Electron's V8 sandbox requires audio buffers owned by the JavaScript runtime.
        enableExternalBuffer: false
      })
      signal.throwIfAborted()
      if (!audio.samples.length || audio.sampleRate <= 0) throw new Error('Speech output is empty')
      if (sampleRate === 0) sampleRate = audio.sampleRate
      else if (audio.sampleRate !== sampleRate) throw new Error('Speech segments use different sample rates')
      parts.push(audio.samples)
    }
    // A short pause keeps a voice change from sounding like a cut.
    const gap = new Float32Array(Math.round(sampleRate * 0.12))
    const total = parts.reduce((sum, part) => sum + part.length, 0) + gap.length * (parts.length - 1)
    const samples = new Float32Array(total)
    let offset = 0
    for (const part of parts) {
      samples.set(part, offset)
      offset += part.length
      if (offset < total) {
        samples.set(gap, offset)
        offset += gap.length
      }
    }
    if (samples.length > 300 * sampleRate) throw new Error('Speech output exceeds five minutes')
    this.runtime.writeWave(input.outputPath, { samples, sampleRate })
  }
}
