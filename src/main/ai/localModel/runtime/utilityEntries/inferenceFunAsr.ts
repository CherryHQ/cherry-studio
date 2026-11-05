import { availableParallelism } from 'node:os'

import type {
  AsrSegment,
  AsrTranscribePayload,
  SherpaAsrModelPaths
} from '@main/ai/localModel/capabilities/asr/protocol'
import type {
  UtilityProcessHandlerContext,
  UtilityProcessLogger
} from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { computeFunAsrNanoChunkSamples, FUNASR_ASR_SAMPLE_RATE, readFunAsrNanoLimits } from './funasrNanoLimits'
import { cacheResource, getSherpa } from './inferenceRuntime'

const VAD_WINDOW_SIZE = 512
const ASR_NUM_THREADS = Math.min(4, availableParallelism())
const COPY_NATIVE_SAMPLES = false
// Parakeet decodes speech in bounded chunks to keep its encoder memory bounded.
const SEGMENT_MODEL_MAX_SECONDS = 30

function modelLoadFailure(error: unknown): Error & { code: string } {
  return Object.assign(new Error('ASR model initialization failed', { cause: error }), {
    code: 'ASR_MODEL_LOAD_FAILED'
  })
}

function recognizerModelConfig(modelPaths: SherpaAsrModelPaths) {
  switch (modelPaths.kind) {
    case 'funasr-nano':
      return {
        funasrNano: {
          encoderAdaptor: modelPaths.encoder,
          llm: modelPaths.llm,
          embedding: modelPaths.embedding,
          tokenizer: modelPaths.tokenizerDir
        },
        tokens: ''
      }
    case 'nemo-transducer':
      return {
        transducer: { encoder: modelPaths.encoder, decoder: modelPaths.decoder, joiner: modelPaths.joiner },
        tokens: modelPaths.tokens,
        modelType: 'nemo_transducer'
      }
  }
}

function getRecognizer(modelPaths: SherpaAsrModelPaths, logger: UtilityProcessLogger): Promise<any> {
  const key = `asr-recognizer|${modelPaths.kind}|${modelPaths.encoder}`
  return cacheResource(key, async () => {
    try {
      const { OfflineRecognizer } = getSherpa()
      const recognizer = new OfflineRecognizer({
        featConfig: { sampleRate: FUNASR_ASR_SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          ...recognizerModelConfig(modelPaths),
          numThreads: ASR_NUM_THREADS,
          provider: 'cpu',
          debug: 0
        }
      })
      logger.info('inference provider active', { provider: 'cpu', runtime: 'asr', model: modelPaths.kind })
      return recognizer
    } catch (error) {
      throw modelLoadFailure(error)
    }
  })
}

function getDetector(modelPath: string): Promise<any> {
  return cacheResource(`asr-vad|${modelPath}`, async () => {
    try {
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
          sampleRate: FUNASR_ASR_SAMPLE_RATE,
          debug: false,
          numThreads: 1
        },
        30
      )
    } catch (error) {
      throw modelLoadFailure(error)
    }
  })
}

function toRecognizerSampleRate(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === FUNASR_ASR_SAMPLE_RATE) return samples
  const { LinearResampler } = getSherpa()
  return new LinearResampler(sampleRate, FUNASR_ASR_SAMPLE_RATE).flush(samples)
}

async function funAsrNanoChunkSamples(
  modelPaths: Extract<SherpaAsrModelPaths, { kind: 'funasr-nano' }>,
  logger: UtilityProcessLogger
): Promise<number> {
  // The FunASR Nano decoder generates the transcript inside the same KV window
  // that holds the prompt and the audio tokens; oversized chunks get their
  // tail silently dropped. Cap chunks at what the downloaded model can carry
  // with a guaranteed output reserve instead of a fixed duration.
  const limits = await readFunAsrNanoLimits(modelPaths)
  const maxChunkSamples = computeFunAsrNanoChunkSamples(limits)
  if (limits.usedFallback) logger.warn('FunASR Nano model metadata incomplete; using documented chunk limits')
  else
    logger.debug('FunASR Nano chunk limits', {
      maxTotalLen: limits.maxTotalLen,
      samplesPerAudioToken: limits.samplesPerAudioToken,
      maxChunkSamples
    })
  return maxChunkSamples
}

function detectSpeech(detector: any, samples: Float32Array): Array<{ samples: Float32Array; start: number }> {
  const speech: Array<{ samples: Float32Array; start: number }> = []
  const drain = () => {
    while (!detector.isEmpty()) {
      const segment = detector.front(COPY_NATIVE_SAMPLES)
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
  stream.acceptWaveform({ sampleRate: FUNASR_ASR_SAMPLE_RATE, samples })
  recognizer.decode(stream)
  return recognizer.getResult(stream).text.trim()
}

export async function transcribeSherpaAsr(
  input: Extract<AsrTranscribePayload, { engine: 'sherpa' }>,
  { logger }: UtilityProcessHandlerContext<never>
): Promise<{ text: string; segments: AsrSegment[] }> {
  const { modelPaths, source } = input
  const audio = source.kind === 'wav' ? getSherpa().readWave(source.filePath, COPY_NATIVE_SAMPLES) : source
  const samples = toRecognizerSampleRate(audio.samples, audio.sampleRate)
  const detector = await getDetector(modelPaths.voiceActivityDetector)
  const speechSegments = detectSpeech(detector, samples)
  if (!speechSegments.length) return { text: '', segments: [] }

  const maxChunkSamples =
    modelPaths.kind === 'funasr-nano'
      ? await funAsrNanoChunkSamples(modelPaths, logger)
      : SEGMENT_MODEL_MAX_SECONDS * FUNASR_ASR_SAMPLE_RATE

  const recognizer = await getRecognizer(modelPaths, logger)
  const segments: AsrSegment[] = []

  for (const speech of speechSegments) {
    for (let offset = 0; offset < speech.samples.length; offset += maxChunkSamples) {
      const chunk = speech.samples.subarray(offset, offset + maxChunkSamples)
      const text = decodeSegment(recognizer, chunk)
      if (!text) {
        logger.debug('ASR chunk decoded empty', {
          startSecond: (speech.start + offset) / FUNASR_ASR_SAMPLE_RATE
        })
        continue
      }
      const start = (speech.start + offset) / FUNASR_ASR_SAMPLE_RATE
      segments.push({ text, start, end: start + chunk.length / FUNASR_ASR_SAMPLE_RATE })
    }
  }

  return { text: segments.map((segment) => segment.text).join('\n'), segments }
}
