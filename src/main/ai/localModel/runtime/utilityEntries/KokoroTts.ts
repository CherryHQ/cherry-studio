import { createRequire } from 'node:module'
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

type KokoroArchitecture = TtsInferenceContract['methods']['synthesize']['input']['architecture']

/**
 * v1.1-zh mixes Chinese and English through both lexicons and leaves the language unset.
 * v1.0 ships multilingual voices; non-lexicon languages go through eSpeak, so the bundle
 * pins `lang` (sherpa-onnx 1.x) and carries only that language's eSpeak data.
 * Piper voices are single-speaker VITS models phonemized by eSpeak; they share this worker.
 */
function kokoroModelConfig(modelDir: string, architecture: KokoroArchitecture) {
  const dataDir = join(modelDir, 'espeak-ng-data')
  if (architecture === 'piper')
    return {
      dataDir,
      model: { vits: { model: join(modelDir, 'model.onnx'), tokens: join(modelDir, 'tokens.txt'), dataDir } },
      ruleFsts: ''
    }
  const common = {
    voices: join(modelDir, 'voices.bin'),
    tokens: join(modelDir, 'tokens.txt'),
    dataDir
  }
  if (architecture === 'kokoro-v1')
    return {
      dataDir,
      model: { kokoro: { ...common, model: join(modelDir, 'model.int8.onnx'), lang: 'pt-br' } },
      ruleFsts: ''
    }
  return {
    dataDir,
    model: {
      kokoro: {
        ...common,
        model: join(modelDir, 'model.onnx'),
        lexicon: ['lexicon-us-en.txt', 'lexicon-zh.txt'].map((file) => join(modelDir, file)).join(',')
      }
    },
    ruleFsts: ['date-zh.fst', 'number-zh.fst', 'phone-zh.fst'].map((file) => join(modelDir, file)).join(',')
  }
}

export class KokoroTts {
  private readonly runtime: KokoroRuntime
  private model?: Awaited<ReturnType<KokoroRuntime['OfflineTts']['createAsync']>>
  private modelDir?: string

  constructor(appPath: string) {
    this.runtime = createRequire(`${appPath}/`)('sherpa-onnx-node')
  }

  async synthesize(input: TtsInferenceContract['methods']['synthesize']['input'], signal: AbortSignal) {
    signal.throwIfAborted()
    if (!this.model || this.modelDir !== input.modelDir) {
      this.model = undefined
      try {
        const config = kokoroModelConfig(input.modelDir, input.architecture)
        process.env.ESPEAK_DATA_PATH = config.dataDir
        this.model = await this.runtime.OfflineTts.createAsync({
          model: {
            ...config.model,
            numThreads: 2,
            provider: 'cpu',
            debug: false
          },
          ruleFsts: config.ruleFsts,
          maxNumSentences: 1
        })
        this.modelDir = input.modelDir
      } catch (cause) {
        throw Object.assign(new Error('Speech model initialization failed', { cause }), {
          code: 'TTS_MODEL_LOAD_FAILED'
        })
      }
    }
    signal.throwIfAborted()
    const audio = this.model.generate({
      text: input.text,
      sid: Number(input.voice),
      speed: input.speed,
      // Electron's V8 sandbox requires audio buffers owned by the JavaScript runtime.
      enableExternalBuffer: false
    })
    signal.throwIfAborted()
    if (!audio.samples.length || audio.sampleRate <= 0) throw new Error('Speech output is empty')
    if (audio.samples.length > 300 * audio.sampleRate) throw new Error('Speech output exceeds five minutes')
    this.runtime.writeWave(input.outputPath, audio)
  }
}
