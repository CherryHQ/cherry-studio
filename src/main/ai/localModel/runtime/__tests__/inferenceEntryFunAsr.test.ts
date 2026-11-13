import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'
import { loadInferenceEntries } from './inferenceEntryHarness'

// Mirrors the observed metadata_props layout of the pinned FunASR Nano artifacts:
// StringStringEntryProto key followed by a 0x12 length-prefixed ASCII value.
const metadataEntry = (key: string, value: string) =>
  Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0x12, value.length]), Buffer.from(value, 'latin1')])

let appPath: string
let modelsDir: string

beforeEach(async () => {
  appPath = await mkdtemp(path.join(tmpdir(), 'cherry-funasr-asr-'))
  modelsDir = path.join(appPath, 'models')
  await mkdir(path.join(modelsDir, 'tokenizer'), { recursive: true })
  const directory = path.join(appPath, 'node_modules/sherpa-onnx-node')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'sherpa-onnx-node', main: 'index.js' }))
  // The chunk splitting must not depend on native behavior: the VAD emits one
  // segment covering all input (continuous speech), and the recognizer reports
  // what it was asked to decode so the test can assert on chunk boundaries.
  await writeFile(
    path.join(directory, 'index.js'),
    `
    const state = { decoded: [], emptyChunksFrom: Infinity }
    class OfflineRecognizer {
      createStream() {
        return { acceptWaveform({ samples }) { this.samples = samples } }
      }
      decode(stream) {
        state.decoded.push(stream.samples.length)
      }
      getResult(stream) {
        if (state.decoded.length >= state.emptyChunksFrom) return { text: '' }
        return { text: 'T'.repeat(Math.max(1, Math.ceil(stream.samples.length / 16000))) }
      }
    }
    class Vad {
      constructor() { this.chunks = []; this.ready = false; this.emitted = false }
      reset() { this.chunks.length = 0; this.ready = false; this.emitted = false }
      acceptWaveform(samples) { this.chunks.push(samples) }
      flush() { this.ready = true }
      isEmpty() { return !this.ready || this.emitted }
      front() {
        let total = 0
        for (const chunk of this.chunks) total += chunk.length
        const samples = new Float32Array(total)
        let offset = 0
        for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length }
        return { samples, start: 0 }
      }
      pop() { this.emitted = true }
    }
    module.exports = {
      OfflineRecognizer,
      Vad,
      state,
      LinearResampler: class { flush(samples) { return samples } },
      readWave: () => ({ samples: new Float32Array(0), sampleRate: 16000 })
    }
  `
  )
})

afterEach(async () => {
  await rm(appPath, { recursive: true, force: true })
})

const writeModelFiles = async (llmMetadata?: Buffer, encoderMetadata?: Buffer) => {
  const encoder = path.join(modelsDir, 'encoder_adaptor.int8.onnx')
  const llm = path.join(modelsDir, 'llm.int8.onnx')
  await writeFile(llm, Buffer.concat([Buffer.from('graph', 'latin1'), ...(llmMetadata ? [llmMetadata] : [])]))
  await writeFile(
    encoder,
    Buffer.concat([Buffer.from('graph', 'latin1'), ...(encoderMetadata ? [encoderMetadata] : [])])
  )
  return {
    engine: 'sherpa' as const,
    modelPaths: {
      encoder,
      llm,
      embedding: path.join(modelsDir, 'embedding.onnx'),
      tokenizerDir: path.join(modelsDir, 'tokenizer'),
      voiceActivityDetector: path.join(modelsDir, 'vad.onnx')
    },
    source: (seconds: number) => ({
      kind: 'samples' as const,
      samples: new Float32Array(16000 * seconds),
      sampleRate: 16000
    })
  }
}

const transcribe = async (payload: Awaited<ReturnType<typeof writeModelFiles>>, seconds: number) => {
  const { asr, logs } = await loadInferenceEntries({
    appPath,
    artifactPaths: {},
    runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
  })
  const result = await asr.transcribe({ ...payload, source: payload.source(seconds) })
  const { state } = createRequire(path.join(appPath, '/'))('sherpa-onnx-node')
  return { result, logs, decoded: state.decoded as number[] }
}

describe('FunASR Nano utility entry', () => {
  it('decodes audio in a single chunk while it fits the KV window budget', async () => {
    // max_total_len=1024 -> 736 audio tokens budget = 706,560 samples > 30s.
    const payload = await writeModelFiles(
      metadataEntry('max_total_len', '1024'),
      metadataEntry('lfr_window_shift', '6')
    )
    const { result, decoded } = await transcribe(payload, 30)
    expect(decoded).toEqual([480_000])
    expect(result).toEqual({ text: 'T'.repeat(30), segments: [{ text: 'T'.repeat(30), start: 0, end: 30 }] })
  })

  it('splits continuous speech by the metadata-derived budget instead of a fixed duration', async () => {
    // max_total_len=512 -> 224 audio tokens budget = 215,040 samples per chunk.
    const payload = await writeModelFiles(metadataEntry('max_total_len', '512'), metadataEntry('lfr_window_shift', '6'))
    const { result, decoded } = await transcribe(payload, 30)
    expect(decoded).toEqual([215_040, 215_040, 49_920])
    expect(result.text).toBe(['T'.repeat(14), 'T'.repeat(14), 'T'.repeat(4)].join('\n'))
    expect(result.segments.map(({ start }) => start)).toEqual([0, 13.44, 26.88])
    expect(result.segments.at(-1)).toMatchObject({ end: 30 })
  })

  it('uses the documented artifact limits when metadata is unreadable', async () => {
    const payload = await writeModelFiles()
    const { result, logs, decoded } = await transcribe(payload, 30)
    expect(decoded).toEqual([215_040, 215_040, 49_920])
    expect(result.segments).toHaveLength(3)
    expect(logs.some((line) => line.includes('documented chunk limits'))).toBe(true)
  })

  it('drops chunks without text instead of fabricating empty segments', async () => {
    const payload = await writeModelFiles(metadataEntry('max_total_len', '512'), metadataEntry('lfr_window_shift', '6'))
    const { asr, logs } = await loadInferenceEntries({
      appPath,
      artifactPaths: {},
      runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
    })
    const { state } = createRequire(path.join(appPath, '/'))('sherpa-onnx-node')
    state.emptyChunksFrom = 2
    const result = await asr.transcribe({ ...payload, source: payload.source(30) })
    expect(state.decoded).toEqual([215_040, 215_040, 49_920])
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]).toMatchObject({ start: 0, end: 13.44 })
    expect(logs.filter((line) => line.includes('chunk decoded empty'))).toHaveLength(2)
  })
})
