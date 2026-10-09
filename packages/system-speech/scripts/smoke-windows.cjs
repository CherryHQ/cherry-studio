const { spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

function inspectPeArchitecture(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid PE executable')
  const offset = bytes.readUInt32LE(0x3c)
  if (offset > bytes.length - 6 || bytes.toString('ascii', offset, offset + 4) !== 'PE\u0000\u0000') {
    throw new Error('Invalid PE executable')
  }
  if (bytes.readUInt16LE(offset + 4) !== 0x8664) throw new Error('Expected an x64 PE executable')
  return 'x64'
}

function inspectPcmWav(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid synthesized WAV')
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Truncated synthesized WAV')
  let hasFormat = false
  let audio
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (length > bytes.length - start) throw new Error('Truncated synthesized WAV chunk')
    if (name === 'fmt ') {
      if (
        length < 16 ||
        bytes.readUInt16LE(start) !== 1 ||
        bytes.readUInt16LE(start + 2) !== 1 ||
        bytes.readUInt32LE(start + 4) !== 16000 ||
        bytes.readUInt32LE(start + 8) !== 32000 ||
        bytes.readUInt16LE(start + 12) !== 2 ||
        bytes.readUInt16LE(start + 14) !== 16
      ) {
        throw new Error('Expected mono 16 kHz PCM16 WAV')
      }
      hasFormat = true
    } else if (name === 'data') audio = bytes.subarray(start, start + length)
    offset = start + length + (length % 2)
  }
  if (!hasFormat || !audio?.length || audio.length % 2 !== 0 || !audio.some((byte) => byte !== 0)) {
    throw new Error('Synthesized WAV has no PCM speech')
  }
  return { sampleRate: 16000, channels: 1, frameCount: audio.length / 2 }
}

function invokeRaw(helperPath, input, schema) {
  const result = spawnSync(helperPath, [], {
    input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    killSignal: 'SIGKILL'
  })
  if (result.error || result.status !== 0 || result.stderr) throw new Error('Windows helper protocol invocation failed')
  try {
    return schema.parse(JSON.parse(result.stdout))
  } catch {
    throw new Error('Invalid Windows helper protocol response')
  }
}

async function protocolSmoke(helperPath) {
  const { nativeResponseSchema } = await import('../dist/contracts.mjs')
  const { SystemSpeechNativeClient } = await import('../dist/SystemSpeechNativeClient.mjs')
  const client = new SystemSpeechNativeClient({ helperPath, timeoutMs: 30_000 })
  const capabilities = await client.request({ operation: 'capabilities', locale: 'en-US' })
  const unsupported = await client.request({ operation: 'capabilities', locale: 'zz-ZZ' })
  if (
    unsupported.result.supportedLocale !== null ||
    unsupported.result.appleAssetStatus !== 'unsupported' ||
    JSON.stringify(unsupported.result.voices) !== JSON.stringify(capabilities.result.voices)
  ) {
    throw new Error('Voice enumeration depends on ASR locale support')
  }
  await client.request({ operation: 'list_asr_locales' })
  const synthesis = {
    operation: 'synthesize',
    voiceId: 'missing-voice',
    text: 'protocol check',
    outputPath: 'unused.wav'
  }
  const invalid = [
    '{}',
    'not json',
    JSON.stringify(synthesis),
    ...[null, '1', 0.49, 2.01].map((speed) => JSON.stringify({ ...synthesis, speed }))
  ]
  for (const input of invalid) {
    const response = invokeRaw(helperPath, input, nativeResponseSchema)
    if (response.ok || response.error.code !== 'invalid_request') throw new Error('Invalid request was accepted')
  }
  const missingVoice = invokeRaw(helperPath, JSON.stringify({ ...synthesis, speed: 1 }), nativeResponseSchema)
  if (missingVoice.ok || missingVoice.error.code !== 'voice_unavailable')
    throw new Error('Missing voice was substituted')
  return capabilities.result.voices
}

async function ttsSmoke(helperPath, voices) {
  if (!voices.length) throw new Error('TTS smoke requires at least one installed SAPI voice')
  const { SystemSpeechNativeClient } = await import('../dist/SystemSpeechNativeClient.mjs')
  const client = new SystemSpeechNativeClient({ helperPath, timeoutMs: 30_000 })
  const directory = mkdtempSync(join(tmpdir(), 'cherry speech-测试-'))
  const frameCounts = []
  try {
    for (const speed of [0.5, 1, 2]) {
      const outputPath = join(directory, `speech-${speed}.wav`)
      const response = await client.request({
        operation: 'synthesize',
        voiceId: voices[0].id,
        text: 'Cherry Studio local speech check. A short sample for the café.',
        outputPath,
        speed
      })
      const actual = inspectPcmWav(readFileSync(outputPath))
      if (Object.entries(actual).some(([key, value]) => response.result[key] !== value)) {
        throw new Error('Synthesized WAV metadata does not match its bytes')
      }
      frameCounts.push(actual.frameCount)
    }
    if (frameCounts[0] <= frameCounts[2]) throw new Error('Installed voice did not apply the requested speed')
    for (const expected of ['cancelled', 'timeout']) {
      const controller = new AbortController()
      const timer = expected === 'cancelled' ? setTimeout(() => controller.abort(), 50) : undefined
      try {
        await new SystemSpeechNativeClient({ helperPath, timeoutMs: expected === 'timeout' ? 50 : 30_000 }).request(
          {
            operation: 'synthesize',
            voiceId: voices[0].id,
            text: 'A long speech cancellation check. '.repeat(10_000),
            outputPath: join(directory, `${expected}.wav`),
            speed: 0.5
          },
          { signal: controller.signal }
        )
        throw new Error('Long synthesis completed before cancellation verification')
      } catch (error) {
        if (error.code !== expected) throw new Error('Windows synthesis cancellation verification failed')
      } finally {
        clearTimeout(timer)
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  return { synthesized: frameCounts.length, cancellation: true, timeout: true }
}

function verifySignature(file) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$signature = Get-AuthenticodeSignature -LiteralPath $env:CHERRY_SPEECH_SIGNED_FILE; if ($signature.Status -ne "Valid") { exit 1 }'
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 30_000, env: { ...process.env, CHERRY_SPEECH_SIGNED_FILE: file } }
  )
  if (result.error || result.status !== 0) throw new Error('Packaged Authenticode signature verification failed')
}

async function main(argv = process.argv.slice(2)) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 is required for this smoke')
  const args = argv.filter((arg) => arg !== '--')
  const packagedIndex = args.indexOf('--packaged')
  const appPath = packagedIndex < 0 ? undefined : resolve(args[packagedIndex + 1] || '')
  const allowed = new Set(['--tts', '--require-signature', '--packaged'])
  if (
    args.some((arg, index) => !(packagedIndex >= 0 && index === packagedIndex + 1) && !allowed.has(arg)) ||
    (packagedIndex >= 0 && (!args[packagedIndex + 1] || args[packagedIndex + 1].startsWith('--'))) ||
    (args.includes('--require-signature') && !appPath)
  ) {
    throw new Error('Expected [--tts] [--packaged app-directory] [--require-signature]')
  }
  const helperPath = appPath
    ? join(appPath, 'resources', 'system-speech', 'cherry-system-speech.exe')
    : resolve(__dirname, '../dist/native/win32-x64/cherry-system-speech.exe')
  inspectPeArchitecture(readFileSync(helperPath))
  if (appPath) inspectPeArchitecture(readFileSync(join(appPath, 'Cherry Studio.exe')))
  const signatureVerified = args.includes('--require-signature')
  if (signatureVerified) {
    verifySignature(helperPath)
    verifySignature(join(appPath, 'Cherry Studio.exe'))
  }
  const voices = await protocolSmoke(helperPath)
  const tts = args.includes('--tts') ? await ttsSmoke(helperPath, voices) : undefined
  process.stdout.write(
    `${JSON.stringify({ architecture: 'x64', protocol: true, installedVoices: voices.length, packaged: !!appPath, signatureVerified, tts })}\n`
  )
}

exports.inspectPeArchitecture = inspectPeArchitecture
exports.inspectPcmWav = inspectPcmWav
exports.main = main

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.code || error.message}\n`)
    process.exitCode = 1
  })
