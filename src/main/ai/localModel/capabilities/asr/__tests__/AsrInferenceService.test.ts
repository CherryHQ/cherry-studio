import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AsrHandlers } from '../../../runtime/__tests__/inferenceEntryHarness'
import { loadInferenceEntries } from '../../../runtime/__tests__/inferenceEntryHarness'
import { CPU_LOCAL_INFERENCE_PROFILE } from '../../../runtime/inferenceAcceleration'

const SHERPA_FAKE = String.raw`
const fs = require('node:fs')
function rejectExternalBuffer(enabled) {
  if (enabled !== false) throw new Error('External buffers are not allowed')
}
class Vad {
  constructor(config) { this.config = config; this.reset() }
  reset() { this.segments = []; this.start = -1; this.position = 0; this.pending = [] }
  acceptWaveform(samples) {
    if (samples.some((value) => value !== 0)) {
      if (this.start === -1) this.start = this.position
      this.pending.push(...samples)
    } else this.flush()
    this.position += samples.length
  }
  flush() {
    if (this.start === -1) return
    this.segments.push({ start: this.start, samples: Float32Array.from(this.pending) })
    this.start = -1; this.pending = []
  }
  isEmpty() { return this.segments.length === 0 }
  front(enabled) { rejectExternalBuffer(enabled); return this.segments[0] }
  pop() { this.segments.shift() }
}
class OfflineRecognizer {
  constructor(config) { this.config = config }
  createStream() { return { acceptWaveform(audio) { this.audio = audio } } }
  decode(stream) { stream.decoded = true }
  getResult(stream) {
    if (stream.audio.samples[0] === 2) return { text: '' }
    if (stream.audio.samples[0] === 3) return { text: JSON.stringify(this.config.modelConfig) }
    return { text: 'decoded ' + stream.audio.samples.length + '@' + stream.audio.sampleRate }
  }
}
class LinearResampler {
  constructor(inputRate, outputRate) { this.ratio = outputRate / inputRate }
  flush(samples) {
    const result = new Float32Array(Math.round(samples.length * this.ratio))
    for (let i = 0; i < result.length; i++) result[i] = samples[Math.floor(i / this.ratio)]
    return result
  }
}
function readWave(filePath, enabled) {
  rejectExternalBuffer(enabled)
  const buffer = fs.readFileSync(filePath)
  return { samples: new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4), sampleRate: 16000 }
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
let logs: string[]

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
  const entries = await loadInferenceEntries({
    appPath: appRoot,
    artifactPaths: { 'sherpa-onnx': '/runtime/sherpa-onnx.node' },
    runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
  })
  asr = entries.asr
  logs = entries.logs
})

afterAll(async () => {
  vi.resetModules()
  await rm(appRoot, { recursive: true, force: true })
})

describe('ASR entry transcribe', () => {
  it('decodes speech stretches separately with timestamps', async () => {
    const result = await transcribe(audio(speech(32), silence(32), speech(16)))

    expect(result.segments.map((segment) => [segment.text, segment.start, segment.end])).toEqual([
      ['decoded 16384@16000', 0, 1.024],
      ['decoded 8192@16000', 2.048, 2.56]
    ])
    expect(result.text).toBe('decoded 16384@16000\ndecoded 8192@16000')
  })

  it('breaks speech into chunks no longer than 25 seconds', async () => {
    const windows = 830
    const result = await transcribe(audio(speech(windows), silence(1)))

    expect(result.segments.map((segment) => segment.text)).toEqual([
      `decoded ${MAX_SEGMENT_SAMPLES}@16000`,
      `decoded ${windows * WINDOW - MAX_SEGMENT_SAMPLES}@16000`
    ])
    expect(result.segments[1].start).toBe(25)
  })

  it('resamples audio to 16kHz', async () => {
    const result = await transcribe(audio(speech(8), silence(8)), 8000)
    expect(result.segments[0].text).toBe('decoded 8192@16000')
  })

  it('reads WAV files without native external buffers', async () => {
    const wavPath = path.join(appRoot, 'recording.wav')
    await writeFile(wavPath, Buffer.from(audio(speech(6), silence(1)).buffer))

    const result = await asr.transcribe({ modelPaths: MODEL_PATHS, source: { kind: 'wav', filePath: wavPath } })
    expect(result.segments[0].text).toBe('decoded 3072@16000')
  })

  it('omits undecodable speech and returns an empty result for silence', async () => {
    const result = await transcribe(audio(speech(8, 2), silence(8), speech(8)))
    expect(result.segments.map((segment) => segment.text)).toEqual(['decoded 4096@16000'])
    await expect(transcribe(silence(16))).resolves.toEqual({ text: '', segments: [] })
  })

  it('configures FunASR with the installed model paths', async () => {
    const result = await transcribe(audio(speech(2, 3), silence(1)))
    expect(JSON.parse(result.text)).toEqual({
      funasrNano: {
        encoderAdaptor: MODEL_PATHS.encoder,
        llm: MODEL_PATHS.llm,
        embedding: MODEL_PATHS.embedding,
        tokenizer: MODEL_PATHS.tokenizerDir
      },
      tokens: '',
      numThreads: expect.any(Number),
      provider: 'cpu',
      debug: 0
    })
    expect(JSON.parse(result.text).numThreads).toBeLessThanOrEqual(4)
  })

  it('does not log transcript text or input paths', async () => {
    const canary = 'PRIVATE_TRANSCRIPT_CANARY'
    const wavPath = path.join(appRoot, `${canary}.wav`)
    await writeFile(wavPath, Buffer.from(audio(speech(2), silence(1)).buffer))

    const result = await asr.transcribe({ modelPaths: MODEL_PATHS, source: { kind: 'wav', filePath: wavPath } })
    expect(result.text).toBeTruthy()
    expect(logs.join('\n')).not.toContain(canary)
    expect(logs.join('\n')).not.toContain(wavPath)
    expect(logs.join('\n')).not.toContain(result.text)
  })
})
