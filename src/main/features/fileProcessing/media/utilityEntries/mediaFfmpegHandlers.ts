/**
 * FFmpeg/ffprobe handlers for the media utility process. Hermetic: no
 * `@application` / `@logger`. Tracks spawned children for abort and dispose.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname, join } from 'node:path'

import type { UtilityProcessHandlers } from '@main/core/utilityProcess/runtime/serveUtilityProcess'
import type { MediaFfmpegContract, MediaProcessInitData } from '@main/features/fileProcessing/media/mediaProcess'
import { classifyFfprobeResult, sniffEbmlDocType } from '@main/features/fileProcessing/media/probeClassification'

type Logger = { debug: (m: string) => void; info: (m: string) => void; warn: (m: string) => void }

const MAX_STDIO_CHARS = 8_000
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
/** WAV headers from FFmpeg often exceed 44 bytes (LIST/INFO); reserve headroom. */
const WAV_HEADER_BUDGET_BYTES = 4_096
const LOCAL_PROTOCOL_WHITELIST = 'file,pipe,crypto'

let init: MediaProcessInitData | null = null
const liveChildren = new Set<ChildProcess>()

export function applyMediaInitData(data: MediaProcessInitData): void {
  init = data
}

export function disposeMediaChildren(logger?: Logger): void {
  for (const child of [...liveChildren]) {
    killProcessTree(child, logger)
  }
  liveChildren.clear()
}

function requireInit(): MediaProcessInitData {
  if (!init) throw new Error('media.ffmpeg utility process is not initialized')
  return init
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
    logger?.warn(
      `failed to kill media child pid=${pid} error=${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function appendBounded(current: string, chunk: string): string {
  if (current.length >= MAX_STDIO_CHARS) return current
  const next = current + chunk
  return next.length <= MAX_STDIO_CHARS ? next : next.slice(0, MAX_STDIO_CHARS)
}

function registerChildPid(pid: number | undefined, pidRegistryPath?: string): void {
  if (pid == null || pid <= 0 || !pidRegistryPath) return
  try {
    mkdirSync(dirname(pidRegistryPath), { recursive: true })
    appendFileSync(pidRegistryPath, `${pid}\n`, 'utf8')
  } catch {
    /* best-effort registry for main-side crash cleanup */
  }
}

async function runCommand(
  bin: string,
  args: string[],
  signal: AbortSignal,
  logger: Logger,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  options: { nostdin?: boolean; pidRegistryPath?: string } = {}
): Promise<{ stdout: string; stderr: string; truncated: boolean }> {
  signal.throwIfAborted()
  // ffprobe rejects `-nostdin`; keep it ffmpeg-only.
  const guardedArgs = [
    '-hide_banner',
    ...(options.nostdin ? (['-nostdin'] as const) : []),
    '-protocol_whitelist',
    LOCAL_PROTOCOL_WHITELIST,
    ...args
  ]

  return await new Promise((resolve, reject) => {
    // Detached:false does NOT make the OS reap children on parent crash (PPID→1).
    // PIDs are also written to pidRegistryPath so main can kill orphans after exit.
    const child = spawn(bin, guardedArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false
    })
    liveChildren.add(child)
    registerChildPid(child.pid, options.pidRegistryPath)

    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    let killReason: unknown | null = null
    const childStdout = child.stdout
    const childStderr = child.stderr
    if (!childStdout || !childStderr) {
      liveChildren.delete(child)
      reject(new Error('Media tool stdio pipes unavailable'))
      return
    }
    childStdout.setEncoding('utf8')
    childStderr.setEncoding('utf8')
    childStdout.on('data', (chunk: string) => {
      const next = appendBounded(stdout, chunk)
      if (next.length < stdout.length + chunk.length) truncated = true
      stdout = next
    })
    childStderr.on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk)
    })

    const requestKill = (reason: unknown) => {
      if (killReason != null || settled) return
      killReason = reason
      killProcessTree(child, logger)
      // Do not settle until `close` — keeps liveChildren accurate and avoids
      // racing temp-dir cleanup against an still-writing grandchild.
    }

    const timer = setTimeout(() => requestKill(new Error('Media processing timed out')), timeoutMs)
    const onAbort = () => requestKill(signal.reason ?? new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })

    const finish = (error?: unknown, value?: { stdout: string; stderr: string; truncated: boolean }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      liveChildren.delete(child)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error instanceof Error ? error : new Error(String(error)))
      else resolve(value!)
    }

    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (killReason != null) {
        finish(killReason)
        return
      }
      if (code === 0) {
        finish(undefined, { stdout, stderr, truncated })
        return
      }
      // Do not embed stderr: it can contain media paths/metadata.
      finish(new Error(`Media tool failed (exit ${code ?? 'unknown'})`))
    })
  })
}

async function fileShaPrefix(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath, { start: 0, end: 1024 * 1024 - 1 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex').slice(0, 12)))
  })
}

function readEbmlDocType(filePath: string): 'webm' | 'matroska' | null {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(512)
    const n = readSync(fd, buf, 0, buf.length, 0)
    return sniffEbmlDocType(buf.subarray(0, n))
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

async function probeJson(
  filePath: string,
  signal: AbortSignal,
  logger: Logger,
  pidRegistryPath?: string
): Promise<unknown> {
  const { ffprobePath } = requireInit()
  // Request only fields we classify on — large container tags/comments must not
  // inflate stdout into the bounded buffer (truncation → SyntaxError).
  const { stdout, truncated } = await runCommand(
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
    DEFAULT_COMMAND_TIMEOUT_MS,
    { nostdin: false, pidRegistryPath }
  )
  if (truncated) throw new Error('Media probe output exceeded buffer; refusing truncated JSON')
  return JSON.parse(stdout)
}

function durationMsFromProbe(probe: unknown): number {
  if (!probe || typeof probe !== 'object') return 0
  const classified = classifyFfprobeResult(probe)
  return classified.durationMs
}

export const mediaFfmpegHandlers: UtilityProcessHandlers<MediaFfmpegContract> = {
  async probe({ filePath, fallbackExt, pidRegistryPath }, { signal, logger }) {
    const parsed = await probeJson(filePath, signal, logger, pidRegistryPath)
    if (!parsed || typeof parsed !== 'object') throw new Error('Media probe returned invalid data')
    const ebmlDocType = readEbmlDocType(filePath)
    return classifyFfprobeResult(parsed, { fallbackExt, ebmlDocType })
  },

  async extractAudio({ filePath, outputDir, maxChunkBytes, pidRegistryPath }, { signal, logger }) {
    const { ffmpegPath } = requireInit()
    mkdirSync(outputDir, { recursive: true })
    const prefix = await fileShaPrefix(filePath)
    const wavPath = join(outputDir, `${prefix}-16k-mono.wav`)

    await runCommand(
      ffmpegPath,
      ['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', wavPath],
      signal,
      logger,
      DEFAULT_COMMAND_TIMEOUT_MS,
      { nostdin: true, pidRegistryPath }
    )

    const totalMs = durationMsFromProbe(await probeJson(wavPath, signal, logger, pidRegistryPath))
    const stat = statSync(wavPath)
    if (stat.size <= maxChunkBytes) {
      return {
        chunks: [{ path: wavPath, startMs: 0, endMs: totalMs, byteLength: stat.size }],
        sampleRateHz: 16000,
        channels: 1
      }
    }

    const usable = Math.max(1, maxChunkBytes - WAV_HEADER_BUDGET_BYTES)
    const bytesPerMs = (16000 * 2) / 1000
    const chunkMs = Math.max(1000, Math.floor(usable / bytesPerMs))
    const chunks: { path: string; startMs: number; endMs: number; byteLength: number }[] = []

    for (let startMs = 0, index = 0; startMs < totalMs; startMs += chunkMs, index++) {
      signal.throwIfAborted()
      const durationMs = Math.min(chunkMs, Math.max(0, totalMs - startMs))
      if (durationMs <= 0) break
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
        DEFAULT_COMMAND_TIMEOUT_MS,
        { nostdin: true, pidRegistryPath }
      )
      const size = statSync(chunkPath).size
      if (size > maxChunkBytes) {
        throw new Error(`Audio chunk exceeded processor size limit (${size} > ${maxChunkBytes})`)
      }
      chunks.push({ path: chunkPath, startMs, endMs: startMs + durationMs, byteLength: size })
    }

    try {
      rmSync(wavPath, { force: true })
    } catch {
      /* ignore */
    }

    return { chunks, sampleRateHz: 16000, channels: 1 }
  },

  async extractFrames(
    { filePath, outputDir, timestampsMs, maxEdgePx, jpegQuality, pidRegistryPath },
    { signal, logger }
  ) {
    const { ffmpegPath } = requireInit()
    mkdirSync(outputDir, { recursive: true })
    const frames: { path: string; timestampMs: number }[] = []
    const quality = Math.min(31, Math.max(2, Math.round(31 - (jpegQuality / 100) * 29)))

    for (let i = 0; i < timestampsMs.length; i++) {
      signal.throwIfAborted()
      const timestampMs = timestampsMs[i]
      const outPath = join(outputDir, `frame-${String(i).padStart(4, '0')}.jpg`)
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
            // Cap BOTH edges while preserving aspect ratio (portrait must not exceed maxEdge on height).
            `scale=w='min(iw,${maxEdgePx})':h='min(ih,${maxEdgePx})':force_original_aspect_ratio=decrease`,
            '-q:v',
            String(quality),
            outPath
          ],
          signal,
          logger,
          DEFAULT_COMMAND_TIMEOUT_MS,
          { nostdin: true, pidRegistryPath }
        )
      } catch (error) {
        signal.throwIfAborted()
        logger.warn(
          `frame extract failed timestampMs=${timestampMs} error=${error instanceof Error ? error.message : String(error)}`
        )
        continue
      }
      if (existsSync(outPath)) frames.push({ path: outPath, timestampMs })
    }

    return { frames }
  }
}
