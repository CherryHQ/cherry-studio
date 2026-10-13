export interface FfprobeStream {
  codec_type?: string
  duration?: string
  disposition?: { attached_pic?: number | string }
  start_time?: string
}

export interface FfprobeFormat {
  duration?: string
  start_time?: string
  format_name?: string
  tags?: Record<string, string>
}

export interface FfprobeResult {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

export interface ClassifiedMediaProbe {
  durationMs: number
  hasAudio: boolean
  hasVideo: boolean
  mime: string
  kind: 'audio' | 'video' | 'unknown'
}

function parseDurationMs(...candidates: Array<string | undefined>): number {
  for (const raw of candidates) {
    if (raw == null || raw === '' || raw === 'N/A') continue
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  }
  return 0
}

function isAttachedPicture(stream: FfprobeStream): boolean {
  const flag = stream.disposition?.attached_pic
  return flag === 1 || flag === '1'
}

function parseFiniteSeconds(value: string | undefined): number | undefined {
  if (value == null || value === '' || value === 'N/A') return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds : undefined
}

export interface VideoTailProbePoint {
  /** Stream start plus stream duration when that duration exists; otherwise format start plus format duration. */
  endSeconds: number
  /** `format.start_time`. Input `-ss` is relative to this, not the video stream start. */
  formatStartTimeSeconds: number
}

/** Where a bounded packet read should look. The video stream end is not an input seek. */
export function videoTailProbePoint(probe: FfprobeResult): VideoTailProbePoint | undefined {
  const video = (probe.streams ?? []).find((stream) => stream.codec_type === 'video' && !isAttachedPicture(stream))
  if (!video) return undefined
  const formatStartTimeSeconds = parseFiniteSeconds(probe.format?.start_time) ?? 0
  const videoDurationSeconds = parseFiniteSeconds(video.duration)
  if (videoDurationSeconds != null && videoDurationSeconds > 0) {
    const videoStartSeconds = parseFiniteSeconds(video.start_time) ?? formatStartTimeSeconds
    return { endSeconds: videoStartSeconds + videoDurationSeconds, formatStartTimeSeconds }
  }
  // An explicit non-positive stream duration is not a missing value, so it does not borrow the format duration.
  if (videoDurationSeconds != null) return undefined
  const formatDurationSeconds = parseFiniteSeconds(probe.format?.duration)
  if (formatDurationSeconds == null || formatDurationSeconds <= 0) return undefined
  return { endSeconds: formatStartTimeSeconds + formatDurationSeconds, formatStartTimeSeconds }
}

/** ffprobe interval covering the end of the video timeline, including a packet that starts earlier. */
export function videoTailReadInterval(endSeconds: number): string {
  return `${(endSeconds - 0.001).toFixed(6)}%${(endSeconds + 0.001).toFixed(6)}`
}

/**
 * Input `-ss` is relative to the format start. Floor so rounding cannot pass the packet PTS.
 */
export function relativeInputSeekMs(ptsSeconds: number, formatStartTimeSeconds: number): number | undefined {
  if (!Number.isFinite(ptsSeconds) || !Number.isFinite(formatStartTimeSeconds)) return undefined
  const timestampMs = Math.floor((ptsSeconds - formatStartTimeSeconds) * 1000 + 1e-6)
  return timestampMs >= 0 ? timestampMs : undefined
}

export function sniffEbmlDocType(header: Uint8Array): 'webm' | 'matroska' | null {
  for (let index = 0; index + 2 < header.length; index += 1) {
    if (header[index] !== 0x42 || header[index + 1] !== 0x82) continue
    const window = Buffer.from(header.subarray(index + 2, Math.min(header.length, index + 40))).toString('ascii')
    if (window.includes('webm')) return 'webm'
    if (window.includes('matroska')) return 'matroska'
  }
  return null
}

function isWebmContainer(
  format: FfprobeFormat | undefined,
  fallbackExt?: string,
  ebmlDocType?: 'webm' | 'matroska' | null
): boolean {
  if (ebmlDocType === 'webm') return true
  if (ebmlDocType === 'matroska') return false
  if (fallbackExt === 'webm') return true
  if (fallbackExt === 'mkv') return false
  const tags = format?.tags ?? {}
  return (tags.DOCTYPE ?? tags.DocType ?? tags.doctype ?? '').toLowerCase() === 'webm'
}

function resolveMime(input: {
  format?: FfprobeFormat
  hasAudio: boolean
  hasVideo: boolean
  fallbackExt?: string
  ebmlDocType?: 'webm' | 'matroska' | null
}): string {
  const names = (input.format?.format_name ?? '')
    .toLowerCase()
    .split(',')
    .map((name) => name.trim())
  const ext = input.fallbackExt
  const matroskaFamily = names.includes('matroska') || names.includes('webm') || names.includes('mkv')

  if (matroskaFamily) {
    if (isWebmContainer(input.format, ext, input.ebmlDocType)) {
      return input.hasVideo ? 'video/webm' : 'audio/webm'
    }
    return input.hasVideo ? 'video/x-matroska' : 'audio/x-matroska'
  }
  if (names.some((name) => ['mp3', 'mp2', 'mp1'].includes(name))) return 'audio/mpeg'
  if (names.includes('wav') || names.includes('w64')) return 'audio/wav'
  if (names.includes('flac')) return 'audio/flac'
  if (names.includes('aac') && !names.some((name) => ['mp4', 'mov', 'ipod'].includes(name))) return 'audio/aac'
  if (names.some((name) => ['ogg', 'oga', 'ogv'].includes(name))) {
    return input.hasVideo ? 'video/ogg' : 'audio/ogg'
  }
  if (names.includes('avi')) return 'video/x-msvideo'
  if (names.includes('flv')) return 'video/x-flv'
  if (names.includes('mpegts') || names.includes('mpeg')) return input.hasVideo ? 'video/mpeg' : 'audio/mpeg'
  if (names.some((name) => ['mp4', 'm4a', 'mov', '3gp', 'ipod'].includes(name))) {
    return input.hasVideo ? 'video/mp4' : 'audio/mp4'
  }

  if (ext === 'webm') return input.hasVideo ? 'video/webm' : 'audio/webm'
  if (ext === 'mkv') return input.hasVideo ? 'video/x-matroska' : 'audio/x-matroska'
  if (ext === 'avi') return 'video/x-msvideo'
  if (ext === 'flv') return 'video/x-flv'
  if (ext === 'aac') return 'audio/aac'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'wav') return 'audio/wav'
  if (ext && ['mp4', 'm4a', 'mov'].includes(ext)) return input.hasVideo ? 'video/mp4' : 'audio/mp4'
  return 'application/octet-stream'
}

export function classifyFfprobeResult(
  probe: FfprobeResult,
  options: { fallbackExt?: string; ebmlDocType?: 'webm' | 'matroska' | null } = {}
): ClassifiedMediaProbe {
  const streams = probe.streams ?? []
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio')
  const hasVideo = streams.some((stream) => stream.codec_type === 'video' && !isAttachedPicture(stream))
  const durationMs = parseDurationMs(probe.format?.duration, ...streams.map((stream) => stream.duration))
  const fallbackExt = options.fallbackExt?.replace(/^\./, '').toLowerCase()
  const mime = resolveMime({
    format: probe.format,
    hasAudio,
    hasVideo,
    fallbackExt,
    ebmlDocType: options.ebmlDocType
  })
  const kind: ClassifiedMediaProbe['kind'] = hasVideo ? 'video' : hasAudio ? 'audio' : 'unknown'
  return { durationMs, hasAudio, hasVideo, mime, kind }
}

export function planFrameTimestamps(durationMs: number, maxFrames: number, targetIntervalMs: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || maxFrames <= 0) return []
  const count = Math.min(maxFrames, Math.max(1, Math.floor(durationMs / Math.max(1, targetIntervalMs)) + 1))
  if (count === 1) return [0]
  const last = Math.max(0, durationMs - 50)
  return Array.from({ length: count }, (_, index) => Math.min(last, Math.round((last * index) / (count - 1))))
}
