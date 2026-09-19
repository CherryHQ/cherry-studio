import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { build } from 'vite'

import { isSystemSpeechError, speechError, throwIfAborted } from '../src/contracts'
import type { CapabilitiesResult } from '../src/contracts'
import { SystemSpeechNativeClient } from '../src/nativeClient'

type ValidationCommand =
  | { kind: 'capabilities'; locale: string }
  | { kind: 'install'; locale: string }
  | { kind: 'roundtrip'; locale: string; voiceId: string; text: string; abortAfterMs?: number; offline: boolean }

interface ElectronMetadata {
  mimeType: string
  sourceDuration: number
  derivedDuration: number
  sampleRate: number
  channels: number
}

const packageRoot = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const helperPath = join(packageRoot, 'dist', 'native', `darwin-${process.arch}`, 'cherry-system-speech')
const sandboxLauncher = {
  executable: '/usr/bin/sandbox-exec',
  args: ['-p', '(version 1) (allow default) (deny network*)']
} as const

async function main(): Promise<void> {
  const command = parseArguments(process.argv.slice(2))
  const client = new SystemSpeechNativeClient({ helperPath })

  if (command.kind === 'capabilities') {
    const value = await client.request({ operation: 'capabilities', locale: command.locale })
    if (value.operation !== 'capabilities') throw speechError('native_helper_failed')
    writeJson(value.result)
    return
  }

  if (command.kind === 'install') {
    const installClient = new SystemSpeechNativeClient({ helperPath, timeoutMs: 30 * 60_000 })
    const value = await installClient.request({
      operation: 'install_asr_assets',
      locale: command.locale,
      confirmDownload: true
    })
    writeJson(value)
    return
  }

  writeJson(await runRoundtrip(client, command))
}

async function runRoundtrip(
  capabilityClient: SystemSpeechNativeClient,
  command: Extract<ValidationCommand, { kind: 'roundtrip' }>
): Promise<Record<string, unknown>> {
  const capabilityValue = await capabilityClient.request({ operation: 'capabilities', locale: command.locale })
  if (capabilityValue.operation !== 'capabilities') throw speechError('native_helper_failed')
  requireReadyCapabilities(capabilityValue.result, command.voiceId)

  if (command.offline) {
    await access(sandboxLauncher.executable, constants.X_OK).catch(() => {
      throw speechError('native_helper_failed')
    })
  }

  const speechClient = command.offline
    ? new SystemSpeechNativeClient({ helperPath, launcher: sandboxLauncher })
    : capabilityClient
  const directory = await mkdtemp(join(tmpdir(), 'cherry-system-speech-'))
  const sourceWavPath = join(directory, 'source.wav')
  const webmPath = join(directory, 'recording.webm')
  const derivedWavPath = join(directory, 'derived.wav')
  const controller = new AbortController()
  const abortTimer = command.abortAfterMs ? setTimeout(() => controller.abort(), command.abortAfterMs) : undefined

  try {
    const synthesis = await speechClient.request(
      { operation: 'synthesize', voiceId: command.voiceId, text: command.text, outputPath: sourceWavPath },
      { signal: controller.signal }
    )
    if (synthesis.operation !== 'synthesize') throw speechError('native_helper_failed')

    throwIfAborted(controller.signal)
    const media = await convertWithElectron(
      { sourceWavPath, webmPath, derivedWavPath, offline: command.offline },
      controller.signal
    )
    const transcription = await speechClient.request(
      { operation: 'transcribe', locale: command.locale, inputPath: derivedWavPath },
      { signal: controller.signal }
    )
    if (transcription.operation !== 'transcribe') throw speechError('native_helper_failed')
    if (transcription.result.text.trim().length === 0) throw speechError('transcription_failed')

    return {
      locale: transcription.result.locale,
      voiceId: synthesis.result.voiceId,
      recordingFormat: media.mimeType,
      pcmFormat: `${media.channels === 1 ? 'mono' : `${media.channels} channels`} ${media.sampleRate} Hz WAV`,
      sourceDuration: media.sourceDuration,
      derivedDuration: media.derivedDuration,
      transcriptNonEmpty: true,
      ...(command.offline ? { networkDenied: true } : {})
    }
  } finally {
    if (abortTimer) clearTimeout(abortTimer)
    await rm(directory, { recursive: true, force: true })
  }
}

function requireReadyCapabilities(capabilities: CapabilitiesResult, voiceId: string): void {
  if (capabilities.appleAssetStatus !== 'installed') throw speechError('asset_required')
  if (!capabilities.voices.some((voice) => voice.id === voiceId)) throw speechError('voice_unavailable')
}

async function convertWithElectron(
  input: { sourceWavPath: string; webmPath: string; derivedWavPath: string; offline: boolean },
  signal: AbortSignal
): Promise<ElectronMetadata> {
  throwIfAborted(signal)
  await build({
    configFile: join(packageRoot, 'validation', 'electron', 'vite.config.ts'),
    logLevel: 'silent'
  })
  throwIfAborted(signal)

  const electronPath = require('electron') as string
  const mainPath = join(packageRoot, 'validation', 'electron', 'main.cjs')
  const electronArguments = [
    ...(input.offline ? ['--no-sandbox', '--disable-gpu'] : []),
    mainPath,
    '--source-wav',
    input.sourceWavPath,
    '--webm',
    input.webmPath,
    '--wav',
    input.derivedWavPath
  ]
  const executable = input.offline ? sandboxLauncher.executable : electronPath
  const args = input.offline ? [...sandboxLauncher.args, electronPath, ...electronArguments] : electronArguments

  return new Promise<ElectronMetadata>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined

    child.stderr.resume()

    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      complete()
    }
    const abort = () => {
      child.kill('SIGTERM')
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2_000)
      finish(() => reject(speechError('cancelled', signal.reason)))
    }

    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > 1024 * 1024) {
        child.kill('SIGTERM')
        finish(() => reject(speechError('audio_conversion_failed')))
        return
      }
      stdout.push(chunk)
    })
    child.once('error', (error) => finish(() => reject(speechError('audio_conversion_failed', error))))
    child.once('close', (code) => {
      if (killTimer) clearTimeout(killTimer)
      if (settled) return
      if (code !== 0) {
        finish(() => reject(speechError('audio_conversion_failed')))
        return
      }
      try {
        const metadata = JSON.parse(Buffer.concat(stdout).toString('utf8')) as ElectronMetadata
        if (!isElectronMetadata(metadata)) throw new Error('Invalid Electron conversion response')
        finish(() => resolve(metadata))
      } catch (error) {
        finish(() => reject(speechError('audio_conversion_failed', error)))
      }
    })

    if (signal.aborted) abort()
  })
}

function isElectronMetadata(value: unknown): value is ElectronMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Record<string, unknown>
  return (
    metadata.mimeType === 'audio/webm;codecs=opus' &&
    typeof metadata.sourceDuration === 'number' &&
    typeof metadata.derivedDuration === 'number' &&
    typeof metadata.sampleRate === 'number' &&
    typeof metadata.channels === 'number'
  )
}

function parseArguments(argv: string[]): ValidationCommand {
  const normalizedArguments = argv[0] === '--' ? argv.slice(1) : argv
  const [operation, ...tokens] = normalizedArguments
  if (!operation) throw speechError('invalid_request')

  const values = new Map<string, string | true>()
  for (let index = 0; index < tokens.length; index += 1) {
    const name = tokens[index]
    if (!name?.startsWith('--') || values.has(name)) throw speechError('invalid_request')
    if (name === '--confirm-download') {
      values.set(name, true)
      continue
    }
    const value = tokens[index + 1]
    if (!value || value.startsWith('--')) throw speechError('invalid_request')
    values.set(name, value)
    index += 1
  }

  const locale = requiredValue(values, '--locale')
  if (operation === 'capabilities') {
    requireOnly(values, ['--locale'])
    return { kind: 'capabilities', locale }
  }
  if (operation === 'install-asr-assets') {
    requireOnly(values, ['--locale', '--confirm-download'])
    if (values.get('--confirm-download') !== true) throw speechError('invalid_request')
    return { kind: 'install', locale }
  }
  if (operation === 'roundtrip' || operation === 'offline') {
    requireOnly(values, ['--locale', '--voice-id', '--text', '--abort-after-ms'])
    const abortValue = values.get('--abort-after-ms')
    const abortAfterMs = abortValue === undefined ? undefined : Number(abortValue)
    if (abortAfterMs !== undefined && (!Number.isInteger(abortAfterMs) || abortAfterMs <= 0)) {
      throw speechError('invalid_request')
    }
    return {
      kind: 'roundtrip',
      locale,
      voiceId: requiredValue(values, '--voice-id'),
      text: requiredValue(values, '--text'),
      ...(abortAfterMs === undefined ? {} : { abortAfterMs }),
      offline: operation === 'offline'
    }
  }
  throw speechError('invalid_request')
}

function requiredValue(values: Map<string, string | true>, name: string): string {
  const value = values.get(name)
  if (typeof value !== 'string' || value.length === 0) throw speechError('invalid_request')
  return value
}

function requireOnly(values: Map<string, string | true>, names: string[]): void {
  const allowed = new Set(names)
  if ([...values.keys()].some((name) => !allowed.has(name))) throw speechError('invalid_request')
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

main().catch((error: unknown) => {
  const normalized = isSystemSpeechError(error) ? error : speechError('native_helper_failed', error)
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: normalized.code, message: normalized.message } })}\n`
  )
  process.exitCode = 1
})
