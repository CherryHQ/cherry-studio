const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

async function main() {
  assert.equal(process.platform, 'win32')
  assert.equal(process.arch, 'arm64')
  for (const filename of fs.readdirSync('runtime').filter((file) => /\.(node|dll)$/.test(file))) {
    const bytes = fs.readFileSync(path.join('runtime', filename))
    assert.equal(bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 4), 0xaa64, filename)
  }
  const sherpa = require(path.resolve('smoke/node_modules/sherpa-onnx-node'))
  assert.equal(sherpa.version, require('./sherpa-arm64-runtime.json').version)
  const directory = path.resolve('.native-models/kokoro-multi-lang-v1.1')
  const started = performance.now()
  const model = await sherpa.OfflineTts.createAsync({
    model: {
      kokoro: {
        model: path.join(directory, 'model.onnx'),
        voices: path.join(directory, 'voices.bin'),
        tokens: path.join(directory, 'tokens.txt'),
        dataDir: path.join(directory, 'espeak-ng-data'),
        lexicon: ['lexicon-us-en.txt', 'lexicon-zh.txt'].map((file) => path.join(directory, file)).join(',')
      },
      numThreads: 2,
      provider: 'cpu',
      debug: false
    },
    ruleFsts: ['date-zh.fst', 'number-zh.fst', 'phone-zh.fst'].map((file) => path.join(directory, file)).join(','),
    maxNumSentences: 1
  })
  const audio = model.generate({
    text: '你好，今天我们测试 Windows ARM 和 English speech。',
    sid: 3,
    speed: 1,
    enableExternalBuffer: false
  })
  assert(audio.samples.length > audio.sampleRate)
  assert.equal(audio.sampleRate, 24000)
  assert(audio.samples.every(Number.isFinite))
  assert(
    audio.samples.some((sample) => Math.abs(sample) > 0.001),
    'Synthesized audio must not be silent'
  )
  const host = process.type === 'utility' ? 'electron' : 'node'
  sherpa.writeWave(path.resolve(`runtime/${host}-mixed.wav`), audio)
  const ttsMs = performance.now() - started
  const asrDirectory = path.resolve('.native-models/funasr-nano-int8')
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      funasrNano: {
        encoderAdaptor: path.join(asrDirectory, 'encoder_adaptor.int8.onnx'),
        llm: path.join(asrDirectory, 'llm.int8.onnx'),
        embedding: path.join(asrDirectory, 'embedding.int8.onnx'),
        tokenizer: path.join(asrDirectory, 'Qwen3-0.6B')
      },
      tokens: '',
      numThreads: 2,
      provider: 'cpu',
      debug: false
    }
  })
  const samples = new sherpa.LinearResampler(audio.sampleRate, 16000).flush(audio.samples)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: 16000, samples })
  const asrStarted = performance.now()
  recognizer.decode(stream)
  const result = recognizer.getResult(stream)
  assert(result.text.trim().length > 0)
  const report = {
    host,
    arch: process.arch,
    versions: process.versions,
    sherpa: sherpa.version,
    durationSeconds: audio.samples.length / audio.sampleRate,
    ttsMs,
    asrMs: performance.now() - asrStarted,
    transcript: result.text
  }
  fs.writeFileSync(`runtime/${host}-result.json`, JSON.stringify(report, null, 2))
  process.stdout.write(JSON.stringify(report) + '\n')
  return report
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(error.stack + '\n')
      process.exit(1)
    }
  )
}

module.exports = { main }
