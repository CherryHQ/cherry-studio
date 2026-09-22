import { availableParallelism } from 'node:os'

import type { AsrModelPaths, AsrSegment } from '@main/ai/localModel/capabilities/asr/protocol'
import type { AsrInferenceContract } from '@main/ai/localModel/runtime/inferenceProcess'
import type {
  UtilityProcessHandlers,
  UtilityProcessLogger
} from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { cacheResource, getSherpa } from './inferenceRuntime'

const ASR_SAMPLE_RATE = 16_000
const VAD_WINDOW_SIZE = 512
const MAX_SEGMENT_SAMPLES = 25 * ASR_SAMPLE_RATE
const ASR_NUM_THREADS = Math.min(4, availableParallelism())

function getRecognizer(modelPaths: AsrModelPaths, logger: UtilityProcessLogger): Promise<any> {
  const key = `asr-recognizer|${modelPaths.encoder}|${modelPaths.llm}|${modelPaths.embedding}|${modelPaths.tokenizerDir}`
  return cacheResource(key, async () => {
    const { OfflineRecognizer } = getSherpa()
    const recognizer = new OfflineRecognizer({
      featConfig: { sampleRate: ASR_SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        funasrNano: {
          encoderAdaptor: modelPaths.encoder,
          llm: modelPaths.llm,
          embedding: modelPaths.embedding,
          tokenizer: modelPaths.tokenizerDir
        },
        tokens: '',
        numThreads: ASR_NUM_THREADS,
        provider: 'cpu',
        debug: 0
      }
    })
    logger.info('inference provider active', { provider: 'cpu', runtime: 'asr' })
    return recognizer
  })
}

function getDetector(modelPath: string): Promise<any> {
  return cacheResource(`asr-vad|${modelPath}`, async () => {
    const { Vad } = getSherpa()
    return new Vad(
      {
        sileroVad: {
          model: modelPath,
          threshold: 0.5,
          minSpeechDuration: 0.25,
          minSilenceDuration: 0.5,
          windowSize: VAD_WINDOW_SIZE
        },
        sampleRate: ASR_SAMPLE_RATE,
        debug: false,
        numThreads: 1
      },
      30
    )
  })
}

function toRecognizerSampleRate(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === ASR_SAMPLE_RATE) return samples
  const { LinearResampler } = getSherpa()
  return new LinearResampler(sampleRate, ASR_SAMPLE_RATE).flush(samples)
}

// sherpa hands back sample buffers backed by native memory unless told otherwise, and
// Electron's V8 sandbox rejects those outright ("External buffers are not allowed").
const COPY_SAMPLES = false

function detectSpeech(detector: any, samples: Float32Array): Array<{ samples: Float32Array; start: number }> {
  const speech: Array<{ samples: Float32Array; start: number }> = []
  const drain = () => {
    while (!detector.isEmpty()) {
      const segment = detector.front(COPY_SAMPLES)
      speech.push({ samples: segment.samples, start: segment.start })
      detector.pop()
    }
  }

  detector.reset()
  for (let offset = 0; offset < samples.length; offset += VAD_WINDOW_SIZE) {
    detector.acceptWaveform(samples.subarray(offset, offset + VAD_WINDOW_SIZE))
    drain()
  }
  detector.flush()
  drain()
  return speech
}

function decodeSegment(recognizer: any, samples: Float32Array): string {
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: ASR_SAMPLE_RATE, samples })
  recognizer.decode(stream)
  return recognizer.getResult(stream).text.trim()
}

export const asrHandlers: UtilityProcessHandlers<AsrInferenceContract> = {
  transcribe: async ({ modelPaths, source }, { logger }) => {
    const audio = source.kind === 'wav' ? getSherpa().readWave(source.filePath, COPY_SAMPLES) : source
    const samples = toRecognizerSampleRate(audio.samples, audio.sampleRate)
    const recognizer = await getRecognizer(modelPaths, logger)
    const detector = await getDetector(modelPaths.voiceActivityDetector)
    const segments: AsrSegment[] = []

    for (const speech of detectSpeech(detector, samples)) {
      for (let offset = 0; offset < speech.samples.length; offset += MAX_SEGMENT_SAMPLES) {
        const chunk = speech.samples.subarray(offset, offset + MAX_SEGMENT_SAMPLES)
        const text = decodeSegment(recognizer, chunk)
        if (!text) continue
        const start = (speech.start + offset) / ASR_SAMPLE_RATE
        segments.push({ text, start, end: start + chunk.length / ASR_SAMPLE_RATE })
      }
    }

    return { text: segments.map((segment) => segment.text).join('\n'), segments }
  }
}
