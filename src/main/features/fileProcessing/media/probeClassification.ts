/**
 * Pure classification of ffprobe JSON into audio/video presence and MIME.
 * Cover-art video streams (`disposition.attached_pic=1`) are not real video.
 */

export interface FfprobeStreamDisposition {
  attached_pic?: number | string
}

export interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  duration?: string
  disposition?: FfprobeStreamDisposition
  tags?: Record<string, string>
}

export interface FfprobeFormat {
  duration?: string
  format_name?: string
  format_long_name?: string
  filename?: string
  tags?: Record<string, string>
}

export interface FfprobeProbeResult {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

export interface ClassifiedMediaProbe {
  durationMs: number
  hasAudio: boolean
  /** True only when a non-attached_pic video stream exists. */
  hasVideo: boolean
  /** Best-effort MIME from container + streams. */
  mime: string
  /** Provisional file kind after probe. */
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

function isAttachedPic(stream: FfprobeStream): boolean {
  const flag = stream.disposition?.attached_pic
  return flag === 1 || flag === '1'
}

/**
 * Decide WebM vs Matroska. Never trust format_long_name ("Matroska / WebM" is
 * shared). Prefer EBML DocType sniff, then extension, then format tags.
 */
export function isWebmContainer(
  format: FfprobeFormat | undefined,
  fallbackExt?: string,
  ebmlDocType?: 'webm' | 'matroska' | null
): boolean {
  if (ebmlDocType === 'webm') return true
  if (ebmlDocType === 'matroska') return false
  if (fallbackExt === 'webm') return true
  if (fallbackExt === 'mkv') return false
  const tags = format?.tags ?? {}
  const docType = (tags.DOCTTYPE || tags.DOCTYPE || tags.DocType || tags.doctype || '').toLowerCase()
  if (docType === 'webm') return true
  if (docType === 'matroska') return false
  // Ambiguous format_name "matroska,webm" without DocType/ext → not WebM.
  return false
}

/** Bounded EBML DocType sniff from the start of a Matroska/WebM file. */
export function sniffEbmlDocType(header: Uint8Array): 'webm' | 'matroska' | null {
  for (let i = 0; i + 2 < header.length; i++) {
    if (header[i] !== 0x42 || header[i + 1] !== 0x82) continue
    const window = Buffer.from(header.subarray(i + 2, Math.min(header.length, i + 40))).toString('ascii')
    if (window.includes('webm')) return 'webm'
    if (window.includes('matroska')) return 'matroska'
  }
  return null
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
    .map((s) => s.trim())
  const ext = input.fallbackExt
  const matroskaFamily = names.includes('matroska') || names.includes('webm') || names.includes('mkv')

  // format_name "matroska,webm" is shared — decide via DocType sniff / extension.
  if (matroskaFamily) {
    if (isWebmContainer(input.format, ext, input.ebmlDocType)) {
      return input.hasVideo ? 'video/webm' : 'audio/webm'
    }
    return input.hasVideo ? 'video/x-matroska' : 'audio/x-matroska'
  }
  if (names.includes('mp3') || names.includes('mp2') || names.includes('mp1')) return 'audio/mpeg'
  if (names.includes('wav') || names.includes('w64')) return 'audio/wav'
  if (names.includes('flac')) return 'audio/flac'
  if (names.includes('aac') && !names.includes('mp4') && !names.includes('mov') && !names.includes('ipod')) {
    return 'audio/aac'
  }
  if (names.includes('ogg') || names.includes('oga') || names.includes('ogv')) {
    return input.hasVideo ? 'video/ogg' : 'audio/ogg'
  }
  if (names.includes('avi')) return 'video/x-msvideo'
  if (names.includes('flv')) return 'video/x-flv'
  if (names.includes('mpegts') || names.includes('mpeg')) {
    return input.hasVideo ? 'video/mpeg' : 'audio/mpeg'
  }
  if (
    names.includes('mp4') ||
    names.includes('m4a') ||
    names.includes('mov') ||
    names.includes('3gp') ||
    names.includes('ipod')
  ) {
    return input.hasVideo ? 'video/mp4' : 'audio/mp4'
  }

  if (ext === 'webm') return input.hasVideo ? 'video/webm' : 'audio/webm'
  if (ext === 'mkv') return input.hasVideo ? 'video/x-matroska' : 'audio/x-matroska'
  if (ext === 'avi') return 'video/x-msvideo'
  if (ext === 'flv') return 'video/x-flv'
  if (ext === 'aac') return 'audio/aac'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'mp4' || ext === 'm4a' || ext === 'mov') return input.hasVideo ? 'video/mp4' : 'audio/mp4'

  if (input.hasVideo) return 'application/octet-stream'
  if (input.hasAudio) return 'application/octet-stream'
  return 'application/octet-stream'
}

export function classifyFfprobeResult(
  probe: FfprobeProbeResult,
  options: { fallbackExt?: string; ebmlDocType?: 'webm' | 'matroska' | null } = {}
): ClassifiedMediaProbe {
  const streams = probe.streams ?? []
  let hasAudio = false
  let hasVideo = false
  const streamDurations: string[] = []

  for (const stream of streams) {
    if (stream.duration) streamDurations.push(stream.duration)
    if (stream.codec_type === 'audio') {
      hasAudio = true
      continue
    }
    if (stream.codec_type === 'video' && !isAttachedPic(stream)) {
      hasVideo = true
    }
  }

  const durationMs = parseDurationMs(probe.format?.duration, ...streamDurations)
  const mime = resolveMime({
    format: probe.format,
    hasAudio,
    hasVideo,
    fallbackExt: options.fallbackExt?.replace(/^\./, '').toLowerCase(),
    ebmlDocType: options.ebmlDocType
  })

  const kind: ClassifiedMediaProbe['kind'] = hasVideo ? 'video' : hasAudio ? 'audio' : 'unknown'
  return { durationMs, hasAudio, hasVideo, mime, kind }
}

/**
 * Evenly spaced timestamps in [0, durationMs), capped by maxFrames.
 * The last sample is clamped below duration so FFmpeg seeking stays inside the
 * last decodable frame for common containers.
 */
export function planFrameTimestamps(durationMs: number, maxFrames: number, targetIntervalMs: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || maxFrames <= 0) return []
  const byInterval = Math.max(1, Math.floor(durationMs / Math.max(1, targetIntervalMs)) + 1)
  const count = Math.min(maxFrames, byInterval)
  if (count === 1) return [0]
  const last = Math.max(0, durationMs - 50)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    out.push(Math.min(last, Math.round((last * i) / (count - 1))))
  }
  return out
}
