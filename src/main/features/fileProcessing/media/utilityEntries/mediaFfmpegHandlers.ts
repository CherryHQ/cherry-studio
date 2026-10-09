import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'

import type { UtilityProcessHandlers } from '@main/core/utilityProcess/runtime/serveUtilityProcess'
import { mediaFfmpegCommandEnv } from '@main/features/fileProcessing/media/mediaFfmpegLoader'
import type {
  MediaExtractedAudioChunk,
  MediaFfmpegContract,
  MediaFfmpegInitData
} from '@main/features/fileProcessing/media/mediaFfmpegProcess'
import { classifyFfprobeResult, sniffEbmlDocType } from '@main/features/fileProcessing/media/probeClassification'

type Logger = { warn: (message: string) => void }

const MAX_STDIO_CHARS = 8_000
const COMMAND_TIMEOUT_MS = 120_000
const WAV_HEADER_BUDGET_BYTES = 4_096
const LOCAL_PROTOCOL_WHITELIST = 'file,pipe,crypto'

let initData: MediaFfmpegInitData | null = null
const liveChildren = new Set<ChildProcess>()

export function applyMediaFfmpegInitData(data: MediaFfmpegInitData): void {
  initData = data
}

export function disposeMediaChildren(logger?: Logger): void {
  for (const child of liveChildren) killProcessTree(child, logger)
  liveChildren.clear()
}

function requireInitData(): MediaFfmpegInitData {
  if (!initData) throw new Error('media.ffmpeg utility process is not initialized')
  return initData
}

function killProcessTree(child: ChildProcess, logger?: Logger): void {
  const pid = child.pid
  if (pid == null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch (error) {
    logger?.warn(`failed to kill media child pid=${pid}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function appendBounded(current: string, chunk: string): { value: string; truncated: boolean } {
  if (current.length >= MAX_STDIO_CHARS) return { value: current, truncated: true }
  const next = current + chunk
  return next.length <= MAX_STDIO_CHARS
    ? { value: next, truncated: false }
    : { value: next.slice(0, MAX_STDIO_CHARS), truncated: true }
}

function registerChildPid(pid: number | undefined, pidRegistryPath?: string): void {
  if (pid == null || pid <= 0 || !pidRegistryPath) return
  try {
    mkdirSync(dirname(pidRegistryPath), { recursive: true })
    writeFileSync(pidRegistryPath, `${pid}\n`, 'utf8')
  } catch {
    // The main process also tracks the worker; this file only covers an orphaned FFmpeg child.
  }
}

function clearChildPid(pid: number | undefined, pidRegistryPath?: string): void {
  if (pid == null || !pidRegistryPath) return
  try {
    if (readFileSync(pidRegistryPath, 'utf8').trim() === String(pid)) rmSync(pidRegistryPath, { force: true })
  } catch {
    // Missing registries are already clean.
  }
}

async function runCommand(
  binary: string,
  args: string[],
  signal: AbortSignal,
  logger: Logger,
  options: { ffmpeg?: boolean; pidRegistryPath?: string } = {}
): Promise<{ stdout: string; truncated: boolean }> {
  signal.throwIfAborted()
  const guardedArgs = [
    '-hide_banner',
    ...(options.ffmpeg ? ['-nostdin'] : []),
    '-protocol_whitelist',
    LOCAL_PROTOCOL_WHITELIST,
    ...args
  ]

  return await new Promise((resolve, reject) => {
    const child = spawn(binary, guardedArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
      env: mediaFfmpegCommandEnv(requireInitData().linuxLibraryDir, process.env)
    })
    liveChildren.add(child)
    registerChildPid(child.pid, options.pidRegistryPath)

    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    let killReason: unknown
    const childStdout = child.stdout
    const childStderr = child.stderr

    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      liveChildren.delete(child)
      clearChildPid(child.pid, options.pidRegistryPath)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error instanceof Error ? error : new Error(String(error)))
      else resolve({ stdout, truncated })
    }
    const requestKill = (reason: unknown) => {
      if (killReason !== undefined || settled) return
      killReason = reason
      killProcessTree(child, logger)
    }
    const onAbort = () => requestKill(signal.reason ?? new Error('Aborted'))
    const timer = setTimeout(() => requestKill(new Error('Media processing timed out')), COMMAND_TIMEOUT_MS)

    if (!childStdout || !childStderr) {
      finish(new Error('Media tool stdio pipes unavailable'))
      return
    }
    childStdout.setEncoding('utf8')
    childStderr.setEncoding('utf8')
    childStdout.on('data', (chunk: string) => {
      const appended = appendBounded(stdout, chunk)
      stdout = appended.value
      truncated ||= appended.truncated
    })
    childStderr.on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk).value
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    child.on('error', finish)
    child.on('close', (code) => {
      if (killReason !== undefined) return finish(killReason)
      if (code === 0) return finish()
      // stderr may contain private media paths and metadata, so never include it.
      finish(new Error(`Media tool failed (exit ${code ?? 'unknown'})`))
    })
  })
}

async function fileHashPrefix(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath, { start: 0, end: 1024 * 1024 - 1 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex').slice(0, 12)))
  })
}

function readEbmlDocType(filePath: string): 'webm' | 'matroska' | null {
  const descriptor = openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(512)
    const bytesRead = readSync(descriptor, header, 0, header.length, 0)
    return sniffEbmlDocType(header.subarray(0, bytesRead))
  } catch {
    return null
  } finally {
    closeSync(descriptor)
  }
}

async function probeJson(
  filePath: string,
  signal: AbortSignal,
  logger: Logger,
  pidRegistryPath?: string
): Promise<unknown> {
  const { ffprobePath } = requireInitData()
  const result = await runCommand(
    ffprobePath,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format=duration,format_name:format_tags=DOCTYPE,DocType,doctype:stream=index,codec_type,codec_name,duration:stream_disposition=attached_pic',
      '-i',
      filePath
    ],
    signal,
    logger,
    { pidRegistryPath }
  )
  if (result.truncated) throw new Error('Media probe output exceeded buffer; refusing truncated JSON')
  return JSON.parse(result.stdout)
}

function probeDurationMs(probe: unknown): number {
  if (!probe || typeof probe !== 'object') return 0
  return classifyFfprobeResult(probe).durationMs
}

export const mediaFfmpegHandlers: UtilityProcessHandlers<MediaFfmpegContract> = {
  async probe({ filePath, fallbackExt, pidRegistryPath }, { signal, logger }) {
    const probe = await probeJson(filePath, signal, logger, pidRegistryPath)
    if (!probe || typeof probe !== 'object') throw new Error('Media probe returned invalid data')
    return classifyFfprobeResult(probe, { fallbackExt, ebmlDocType: readEbmlDocType(filePath) })
  },

  async extractAudio({ filePath, outputDir, maxChunkBytes, pidRegistryPath }, { signal, logger }) {
    if (!Number.isFinite(maxChunkBytes) || maxChunkBytes <= WAV_HEADER_BUDGET_BYTES) {
      throw new TypeError('maxChunkBytes must exceed the WAV header budget')
    }
    const { ffmpegPath } = requireInitData()
    mkdirSync(outputDir, { recursive: true })
    const prefix = await fileHashPrefix(filePath)
    const wavPath = join(outputDir, `${prefix}-16k-mono.wav`)

    await runCommand(
      ffmpegPath,
      ['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', wavPath],
      signal,
      logger,
      { ffmpeg: true, pidRegistryPath }
    )

    const totalMs = probeDurationMs(await probeJson(wavPath, signal, logger, pidRegistryPath))
    const wavSize = statSync(wavPath).size
    if (wavSize <= maxChunkBytes) {
      return {
        chunks: [{ path: wavPath, startMs: 0, endMs: totalMs, byteLength: wavSize }],
        sampleRateHz: 16000,
        channels: 1
      }
    }

    const bytesPerMs = (16000 * 2) / 1000
    const chunkMs = Math.max(1, Math.floor((maxChunkBytes - WAV_HEADER_BUDGET_BYTES) / bytesPerMs))
    const chunks: MediaExtractedAudioChunk[] = []
    for (let startMs = 0, index = 0; startMs < totalMs; startMs += chunkMs, index += 1) {
      signal.throwIfAborted()
      const durationMs = Math.min(chunkMs, totalMs - startMs)
      const chunkPath = join(outputDir, `${prefix}-chunk-${String(index).padStart(3, '0')}.wav`)
      await runCommand(
        ffmpegPath,
        [
          '-y',
          '-ss',
          (startMs / 1000).toFixed(3),
          '-t',
          (durationMs / 1000).toFixed(3),
          '-i',
          wavPath,
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
          '-f',
          'wav',
          chunkPath
        ],
        signal,
        logger,
        { ffmpeg: true, pidRegistryPath }
      )
      const byteLength = statSync(chunkPath).size
      if (byteLength > maxChunkBytes) {
        throw new Error(`Audio chunk exceeded size limit (${byteLength} > ${maxChunkBytes})`)
      }
      chunks.push({ path: chunkPath, startMs, endMs: startMs + durationMs, byteLength })
    }
    rmSync(wavPath, { force: true })
    return { chunks, sampleRateHz: 16000, channels: 1 }
  },

  async extractFrames(
    { filePath, outputDir, timestampsMs, maxEdgePx, jpegQuality, pidRegistryPath },
    { signal, logger }
  ) {
    const { ffmpegPath } = requireInitData()
    mkdirSync(outputDir, { recursive: true })
    const frames: Array<{ path: string; timestampMs: number }> = []
    const quality = Math.min(31, Math.max(2, Math.round(31 - (jpegQuality / 100) * 29)))

    for (let index = 0; index < timestampsMs.length; index += 1) {
      signal.throwIfAborted()
      const timestampMs = timestampsMs[index]
      const outputPath = join(outputDir, `frame-${String(index).padStart(4, '0')}.jpg`)
      try {
        await runCommand(
          ffmpegPath,
          [
            '-y',
            '-ss',
            (timestampMs / 1000).toFixed(3),
            '-i',
            filePath,
            '-frames:v',
            '1',
            '-an',
            '-update',
            '1',
            '-vf',
            `scale=w='min(iw,${maxEdgePx})':h='min(ih,${maxEdgePx})':force_original_aspect_ratio=decrease`,
            '-q:v',
            String(quality),
            outputPath
          ],
          signal,
          logger,
          { ffmpeg: true, pidRegistryPath }
        )
      } catch (error) {
        signal.throwIfAborted()
        logger.warn(
          `frame extract failed timestampMs=${timestampMs}: ${error instanceof Error ? error.message : String(error)}`
        )
        continue
      }
      if (existsSync(outputPath)) frames.push({ path: outputPath, timestampMs })
    }
    return { frames }
  }
}
