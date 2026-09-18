import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AsrHandlers } from '../../../runtime/__tests__/inferenceEntryHarness'
import { loadInferenceEntries } from '../../../runtime/__tests__/inferenceEntryHarness'
import { CPU_LOCAL_INFERENCE_PROFILE } from '../../../runtime/inferenceAcceleration'

const SHERPA_FAKE = String.raw`
const fs = require('node:fs')

function rejectExternalBuffer(enableExternalBuffer) {
  if (enableExternalBuffer !== false) throw new Error('External buffers are not allowed')
}

class Vad {
  constructor(config) {
    this.config = config
    this.reset()
  }
  reset() {
    this.segments = []
    this.start = -1
    this.position = 0
    this.pending = []
  }
  clear() {
    this.segments = []
  }
  acceptWaveform(samples) {
    if (samples.some((value) => value !== 0)) {
      if (this.start === -1) this.start = this.position
      this.pending.push(...samples)
    } else {
      this.flush()
    }
    this.position += samples.length
  }
  flush() {
    if (this.start === -1) return
    this.segments.push({ start: this.start, samples: Float32Array.from(this.pending) })
    this.start = -1
    this.pending = []
  }
  isEmpty() {
    return this.segments.length === 0
  }
  front(enableExternalBuffer) {
    rejectExternalBuffer(enableExternalBuffer)
    return this.segments[0]
  }
  pop() {
    this.segments.shift()
  }
}

class OfflineRecognizer {
  constructor(config) {
    this.config = config
  }
  createStream() {
    return {
      acceptWaveform(audio) {
        this.audio = audio
      }
    }
  }
  decode(stream) {
    stream.decoded = true
  }
  getResult(stream) {
    if (stream.audio.samples[0] === 2) return { text: '' }
    if (stream.audio.samples[0] === 3) return { text: JSON.stringify(this.config.modelConfig.funasrNano) }
    return { text: 'decoded ' + stream.audio.samples.length + '@' + stream.audio.sampleRate }
  }
}

class LinearResampler {
  constructor(inputSampleRate, outputSampleRate) {
    this.ratio = outputSampleRate / inputSampleRate
  }
  flush(samples) {
    const resampled = new Float32Array(Math.round(samples.length * this.ratio))
    for (let i = 0; i < resampled.length; i++) resampled[i] = samples[Math.floor(i / this.ratio)]
    return resampled
  }
}

function readWave(filePath, enableExternalBuffer) {
  rejectExternalBuffer(enableExternalBuffer)
  const buffer = fs.readFileSync(filePath)
  return {
    samples: new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4),
    sampleRate: 16000
  }
}

module.exports = { OfflineRecognizer, Vad, LinearResampler, readWave }
`

const SAMPLE_RATE = 16_000
const MAX_SEGMENT_SAMPLES = 25 * SAMPLE_RATE
const WINDOW = 512
const MODEL_DIR = '/models/funasr-nano'
const MODEL_PATHS = {
  encoder: path.join(MODEL_DIR, 'encoder_adaptor.int8.onnx'),
  llm: path.join(MODEL_DIR, 'llm.int8.onnx'),
  embedding: path.join(MODEL_DIR, 'embedding.int8.onnx'),
  tokenizerDir: path.join(MODEL_DIR, 'Qwen3-0.6B'),
  voiceActivityDetector: path.join(MODEL_DIR, 'silero_vad.onnx')
}

let appRoot: string
let asr: AsrHandlers

function speech(windows: number, value = 1): Float32Array {
  return new Float32Array(windows * WINDOW).fill(value)
}

function silence(windows: number): Float32Array {
  return new Float32Array(windows * WINDOW)
}

function audio(...parts: Float32Array[]): Float32Array {
  const joined = new Float32Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

const transcribe = (samples: Float32Array, sampleRate = SAMPLE_RATE) =>
  asr.transcribe({ modelPaths: MODEL_PATHS, source: { kind: 'samples', samples, sampleRate } })

beforeAll(async () => {
  appRoot = await mkdtemp(path.join(tmpdir(), 'cherry-asr-inference-'))
  const sherpaDir = path.join(appRoot, 'node_modules', 'sherpa-onnx-node')
  await mkdir(sherpaDir, { recursive: true })
  await writeFile(path.join(sherpaDir, 'package.json'), JSON.stringify({ name: 'sherpa-onnx-node', main: 'index.js' }))
  await writeFile(path.join(sherpaDir, 'index.js'), SHERPA_FAKE)
  asr = (
    await loadInferenceEntries({
      appPath: appRoot,
      artifactPaths: { 'sherpa-onnx': '/runtime/sherpa-onnx.node' },
      runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
    })
  ).asr
})

afterAll(async () => {
  vi.resetModules()
  await rm(appRoot, { recursive: true, force: true })
})

describe('ASR entry transcribe', () => {
  it('decodes each stretch of speech separately', async () => {
    const result = await transcribe(audio(speech(16), silence(16), speech(8)))

    expect(result.segments.map((segment) => segment.text)).toEqual(['decoded 8192@16000', 'decoded 4096@16000'])
    expect(result.text).toBe('decoded 8192@16000\ndecoded 4096@16000')
  })

  it('places each segment where it was heard', async () => {
    const result = await transcribe(audio(speech(32), silence(32), speech(16)))

    expect(result.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1.024],
      [2.048, 2.56]
    ])
  })

  it('breaks speech longer than one decode can hold into 25-second chunks', async () => {
    const windows = 830

    const result = await transcribe(audio(speech(windows), silence(1)))

    expect(result.segments.map((segment) => segment.text)).toEqual([
      `decoded ${MAX_SEGMENT_SAMPLES}@16000`,
      `decoded ${windows * WINDOW - MAX_SEGMENT_SAMPLES}@16000`
    ])
    expect(result.segments[1].start).toBe(MAX_SEGMENT_SAMPLES / SAMPLE_RATE)
  })

  it('resamples audio to 16kHz before recognition', async () => {
    const result = await transcribe(audio(speech(8), silence(8)), 8000)

    expect(result.segments[0].text).toBe('decoded 8192@16000')
  })

  it('reads a wav source off disk', async () => {
    const wavPath = path.join(appRoot, 'recording.wav')
    await writeFile(wavPath, Buffer.from(audio(speech(6), silence(1)).buffer))

    const result = await asr.transcribe({ modelPaths: MODEL_PATHS, source: { kind: 'wav', filePath: wavPath } })

    expect(result.segments[0].text).toBe('decoded 3072@16000')
  })

  it('fails a wav source that does not exist', async () => {
    const missing = path.join(appRoot, 'missing.wav')

    await expect(
      asr.transcribe({ modelPaths: MODEL_PATHS, source: { kind: 'wav', filePath: missing } })
    ).rejects.toThrow(/ENOENT/)
  })

  it('omits speech the model could not decode', async () => {
    const result = await transcribe(audio(speech(8, 2), silence(8), speech(8)))

    expect(result.segments.map((segment) => segment.text)).toEqual(['decoded 4096@16000'])
    expect(result.text).toBe('decoded 4096@16000')
  })

  it('returns an empty transcript when there is no speech', async () => {
    await expect(transcribe(silence(16))).resolves.toEqual({ text: '', segments: [] })
  })

  it('configures the recognizer with installed model files and the tokenizer directory', async () => {
    const result = await transcribe(audio(speech(2, 3), silence(1)))

    expect(JSON.parse(result.text)).toEqual({
      encoderAdaptor: MODEL_PATHS.encoder,
      llm: MODEL_PATHS.llm,
      embedding: MODEL_PATHS.embedding,
      tokenizer: MODEL_PATHS.tokenizerDir
    })
  })
})
