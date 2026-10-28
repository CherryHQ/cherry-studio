import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'
import type { AsrInferenceContract } from '../inferenceProcess'
import { loadInferenceEntries } from './inferenceEntryHarness'

let appPath: string

beforeEach(async () => {
  appPath = await mkdtemp(path.join(tmpdir(), 'cherry-mlx-asr-'))
  const directory = path.join(appPath, 'node_modules/@cherrystudio/mlx-asr')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
  await writeFile(
    path.join(directory, 'index.js'),
    `
    let attempts = 0
    export class Qwen3AsrModel {
      static async load(dir) {
        if (dir === '/retry' && attempts++ === 0) throw new Error('load failed')
        return new Qwen3AsrModel()
      }
      async createStream() {
        if (this.active) throw new Error('Previous stream leaked')
        this.active = true
        let count = 0
        return {
          feed: async (samples) => {
            if (samples[0] === 2) throw new Error('Native feed failed')
            count += samples.length
            return { text: '🧪你好 ' + count, stableText: '🧪', revision: count, isFinal: false, reachedMaxTokens: false }
          },
          finish: async () => {
            this.active = false
            return { text: '🧪你好 ' + count, stableText: '🧪你好 ' + count, revision: count + 1, isFinal: true, reachedMaxTokens: false }
          }
        }
      }
      async transcribe(samples, options) {
        if (options.language) throw new Error('Expected automatic language detection')
        if (options.sampleRate !== 16000) throw new Error('Wrong sample rate')
        return { text: '  你好 Hello  ', isFinal: samples[0] !== 2, reachedMaxTokens: samples[0] === 3 }
      }
    }
  `
  )
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(appPath, { recursive: true, force: true })
})

const input = (first = 0, modelDir = '/model') => ({
  engine: 'mlx' as const,
  modelDir,
  source: { kind: 'samples' as const, samples: new Float32Array([first]), sampleRate: 16000 }
})
const load = () => loadInferenceEntries({ appPath, artifactPaths: {}, runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE })

describe('Qwen3 ASR utility entry', () => {
  it('recognizes complete audio without loading Sherpa or fabricating timestamps', async () => {
    const { asr } = await load()
    await expect(asr.transcribe(input())).resolves.toEqual({ text: '你好 Hello', segments: [] })
  })

  it.each([2, 3])('rejects incomplete recognition instead of silently accepting truncated text (%s)', async (first) => {
    const { asr } = await load()
    await expect(asr.transcribe(input(first))).rejects.toThrow('truncated')
  })

  it('allows another attempt after native model initialization fails', async () => {
    const { asr } = await load()
    await expect(asr.transcribe(input(0, '/retry'))).rejects.toMatchObject({ code: 'ASR_MODEL_LOAD_FAILED' })
    await expect(asr.transcribe(input(0, '/retry'))).resolves.toEqual({ text: '你好 Hello', segments: [] })
  })

  it.each([NaN, Infinity])('rejects non-finite PCM before native inference (%s)', async (first) => {
    const { asr } = await load()
    await expect(asr.transcribe(input(first))).rejects.toMatchObject({ code: 'VOICE_AUDIO_INVALID' })
  })

  it('rejects empty or incorrectly sampled PCM', async () => {
    const { asr } = await load()
    const request = input()
    request.source.sampleRate = 48000
    await expect(asr.transcribe(request)).rejects.toMatchObject({ code: 'VOICE_AUDIO_INVALID' })
    request.source.sampleRate = 16000
    request.source.samples = new Float32Array()
    await expect(asr.transcribe(request)).rejects.toMatchObject({ code: 'VOICE_AUDIO_INVALID' })
  })
})

describe('Qwen3 ASR streaming entry', () => {
  async function run(samples: Float32Array[], offsets?: number[]) {
    const { asrStreamHandlers } = await import('../utilityEntries/inferenceQwen3Asr')
    const frames: Array<AsrInferenceContract['streams']['transcribe']['output']> = []
    const result = await asrStreamHandlers.transcribe(
      { modelDir: '/model', sampleRate: 16000 },
      {
        signal: new AbortController().signal,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        write: async (frame) => {
          frames.push(frame)
        },
        input: {
          async *[Symbol.asyncIterator]() {
            let offset = 0
            for (const [i, batch] of samples.entries()) {
              yield { metadata: { startFrame: offsets?.[i] ?? offset }, payload: new Uint8Array(batch.buffer) }
              offset += batch.length
            }
          }
        }
      }
    )
    return { result, frames }
  }

  it('preserves the partial tail and reports provisional positions in UTF-16', async () => {
    await load()
    const { result, frames } = await run([new Float32Array(1600), new Float32Array(131)])
    expect(result).toEqual({ text: '🧪你好 1731' })
    expect(frames[0]).toEqual({ metadata: { type: 'ready' } })
    expect(frames[1].metadata).toMatchObject({ provisionalStart: 2, final: false })
    expect(frames.at(-1)?.metadata).toMatchObject({ text: '🧪你好 1731', final: true })
  })

  it('rejects a discontinuity and releases the native stream before another attempt', async () => {
    await load()
    await expect(run([new Float32Array(1600), new Float32Array(1)], [0, 1601])).rejects.toThrow('sequence')
    expect((await run([new Float32Array(7)])).result.text).toBe('🧪你好 7')
  })

  it('cleans up after a native feed failure and accepts a subsequent stream', async () => {
    await load()
    await expect(run([new Float32Array([2])])).rejects.toThrow('Native feed failed')
    expect((await run([new Float32Array(9)])).result.text).toBe('🧪你好 9')
  })
})
