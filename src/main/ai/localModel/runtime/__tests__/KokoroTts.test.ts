import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { KokoroTts } from '../utilityEntries/KokoroTts'

let directory: string
const originalEspeakDataPath = process.env.ESPEAK_DATA_PATH

afterEach(async () => {
  vi.unstubAllEnvs()
  if (directory) await rm(directory, { recursive: true, force: true })
  if (originalEspeakDataPath === undefined) delete process.env.ESPEAK_DATA_PATH
  else process.env.ESPEAK_DATA_PATH = originalEspeakDataPath
})

it('generates a WAV through the sandbox-compatible Sherpa contract with both lexicons', async () => {
  directory = await mkdtemp(join(tmpdir(), 'kokoro-runtime-'))
  const packageDir = join(directory, 'node_modules', 'sherpa-onnx-node')
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'index.js'),
    `
    const fs = require('node:fs');
    module.exports = {
      OfflineTts: { createAsync: async config => {
        const lexicon = config.model.kokoro.lexicon;
        if (!lexicon.includes('lexicon-zh.txt') || !lexicon.includes('lexicon-us-en.txt') || config.model.kokoro.lang)
          throw Error('Mixed language frontend unavailable');
        if (process.env.ESPEAK_DATA_PATH !== config.model.kokoro.dataDir)
          throw Error('eSpeak data path is not available to the native runtime');
        return { generate: request => {
          if (request.enableExternalBuffer !== false) throw Error('External buffers are not allowed');
          if (request.text !== '你好 Hello') throw Error('Mixed text was changed');
          return { samples: new Float32Array([0, 0.5]), sampleRate: 24000 };
        }};
      }},
      writeWave: (filename, audio) => {
        const wav = Buffer.alloc(44 + audio.samples.length * 2);
        wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
        wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22); wav.writeUInt32LE(audio.sampleRate, 24);
        wav.writeUInt32LE(audio.sampleRate * 2, 28); wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
        fs.writeFileSync(filename, wav);
      }
    };
  `
  )
  const outputPath = join(directory, 'speech.wav')
  await new KokoroTts(directory).synthesize(
    {
      architecture: 'kokoro',
      modelDir: directory,
      text: '你好 Hello',
      voice: '3',
      language: 'zh-CN',
      speed: 1,
      outputPath
    },
    new AbortController().signal
  )
  expect(process.env.ESPEAK_DATA_PATH).toBe(join(directory, 'espeak-ng-data'))
  const audio = await readFile(outputPath)
  expect(audio.toString('ascii', 0, 4)).toBe('RIFF')
  expect(audio.readUInt32LE(24)).toBe(24000)
  expect(audio.readUInt32LE(4) + 8).toBe(audio.length)
  expect(audio.readUInt32LE(40)).toBeGreaterThan(0)
})

it('configures the int8 pt-br model without lexicons and reloads when the model directory changes', async () => {
  directory = await mkdtemp(join(tmpdir(), 'kokoro-runtime-v1-'))
  const packageDir = join(directory, 'node_modules', 'sherpa-onnx-node')
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'index.js'),
    `
    const fs = require('node:fs');
    module.exports = {
      OfflineTts: { createAsync: async config => {
        fs.appendFileSync(process.env.KOKORO_TEST_LOG, JSON.stringify(config) + '\\n');
        return { generate: () => ({ samples: new Float32Array([0, 0.5]), sampleRate: 24000 }) };
      }},
      writeWave: (filename) => fs.writeFileSync(filename, 'wav')
    };
  `
  )
  const log = join(directory, 'configs.log')
  vi.stubEnv('KOKORO_TEST_LOG', log)
  const first = join(directory, 'first')
  const second = join(directory, 'second')
  const tts = new KokoroTts(directory)
  const input = {
    architecture: 'kokoro-v1' as const,
    modelDir: first,
    text: 'Olá',
    voice: '42',
    language: 'pt-BR',
    speed: 1,
    outputPath: join(directory, 'speech.wav')
  }
  await tts.synthesize(input, new AbortController().signal)
  await tts.synthesize(input, new AbortController().signal)
  await tts.synthesize({ ...input, modelDir: second }, new AbortController().signal)
  const configs = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(configs).toHaveLength(2)
  expect(configs[0]).toMatchObject({
    ruleFsts: '',
    model: {
      kokoro: {
        model: join(first, 'model.int8.onnx'),
        voices: join(first, 'voices.bin'),
        tokens: join(first, 'tokens.txt'),
        dataDir: join(first, 'espeak-ng-data'),
        lang: 'pt-br'
      }
    }
  })
  expect(configs[0].model.kokoro).not.toHaveProperty('lexicon')
  expect(configs[1].model.kokoro.model).toBe(join(second, 'model.int8.onnx'))
  expect(process.env.ESPEAK_DATA_PATH).toBe(join(second, 'espeak-ng-data'))
})

it('configures a Piper voice as a single-speaker VITS model with no kokoro section', async () => {
  directory = await mkdtemp(join(tmpdir(), 'piper-runtime-'))
  const packageDir = join(directory, 'node_modules', 'sherpa-onnx-node')
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'index.js'),
    `
    const fs = require('node:fs');
    module.exports = {
      OfflineTts: { createAsync: async config => {
        fs.appendFileSync(process.env.KOKORO_TEST_LOG, JSON.stringify(config) + '\\n');
        return { generate: () => ({ samples: new Float32Array([0, 0.5]), sampleRate: 22050 }) };
      }},
      writeWave: (filename) => fs.writeFileSync(filename, 'wav')
    };
  `
  )
  const log = join(directory, 'configs.log')
  vi.stubEnv('KOKORO_TEST_LOG', log)
  const modelDir = join(directory, 'piper')
  await new KokoroTts(directory).synthesize(
    {
      architecture: 'piper',
      modelDir,
      text: 'Olá',
      voice: '0',
      language: 'pt-BR',
      speed: 1,
      outputPath: join(directory, 'speech.wav')
    },
    new AbortController().signal
  )
  const [config] = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(config.ruleFsts).toBe('')
  expect(config.model).not.toHaveProperty('kokoro')
  expect(config.model.vits).toEqual({
    model: join(modelDir, 'model.onnx'),
    tokens: join(modelDir, 'tokens.txt'),
    dataDir: join(modelDir, 'espeak-ng-data')
  })
  expect(process.env.ESPEAK_DATA_PATH).toBe(join(modelDir, 'espeak-ng-data'))
})
