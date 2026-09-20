import {
  type MediaAnalysis,
  type MediaAudioSegment,
  type MediaVisualFrame,
  MEDIA_ANALYSIS_VERSION
} from '@shared/types/mediaAnalysis'

const SECTION_AUDIO = '## Audio transcript'
const SECTION_VISUAL = '## Visual scenes'
const SECTION_OCR = '## On-screen text'
const SECTION_WARNINGS = '## Warnings'

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatAudioSegments(segments: MediaAudioSegment[]): string[] {
  const lines: string[] = []
  for (const segment of segments) {
    const text = segment.text.trim()
    if (!text) continue
    const speaker = segment.speaker?.trim()
    const prefix = speaker
      ? `[${formatTimestamp(segment.startMs)}] ${speaker}: `
      : `[${formatTimestamp(segment.startMs)}] `
    lines.push(`${prefix}${text}`)
  }
  return lines
}

function formatVisualSummaries(frames: MediaVisualFrame[]): string[] {
  const lines: string[] = []
  for (const frame of frames) {
    const summary = frame.summary?.trim()
    if (!summary) continue
    lines.push(`[${formatTimestamp(frame.timestampMs)}] ${summary}`)
  }
  return lines
}

function formatOcrLines(frames: MediaVisualFrame[]): string[] {
  const lines: string[] = []
  for (const frame of frames) {
    const ocr = frame.ocrText?.trim()
    if (!ocr) continue
    lines.push(`[${formatTimestamp(frame.timestampMs)}] ${ocr}`)
  }
  return lines
}

function audioSectionBody(analysis: MediaAnalysis): string {
  if (!analysis.audio) {
    return analysis.source.hasAudio ? '(audio transcription unavailable)' : '(no audio track)'
  }
  const lines = formatAudioSegments(analysis.audio.segments)
  return lines.length > 0 ? lines.join('\n') : '(no speech)'
}

/**
 * Full timeline serialization used by `read_file`. Pagination offsets apply to
 * this string only — never to the compact inline summary.
 */
export function formatMediaAnalysisFull(analysis: MediaAnalysis): string {
  const parts: string[] = [
    `# Media analysis`,
    `MIME: ${analysis.source.mime}`,
    `Duration: ${formatTimestamp(analysis.source.durationMs)}`,
    `Has audio: ${analysis.source.hasAudio}`,
    `Has video: ${analysis.source.hasVideo}`
  ]

  parts.push('', SECTION_AUDIO, audioSectionBody(analysis))

  const visualLines = formatVisualSummaries(analysis.visuals ?? [])
  parts.push('', SECTION_VISUAL, visualLines.length > 0 ? visualLines.join('\n') : '(no visual summaries)')

  const ocrLines = formatOcrLines(analysis.visuals ?? [])
  parts.push('', SECTION_OCR, ocrLines.length > 0 ? ocrLines.join('\n') : '(no on-screen text)')

  if (analysis.warnings.length > 0) {
    parts.push('', SECTION_WARNINGS, ...analysis.warnings.map((w) => `- ${w}`))
  }

  return parts.join('\n')
}

export interface CompactMediaTextBudget {
  /** Total character budget for the inline compact projection. */
  maxChars: number
}

const DEFAULT_COMPACT_BUDGET: CompactMediaTextBudget = { maxChars: 12_000 }

/**
 * Balanced compact projection for chat/agent inline context. Reserves section
 * headers first, then splits the remaining body budget evenly so a long
 * transcript cannot drop OCR/visuals.
 */
export function formatMediaAnalysisCompact(
  analysis: MediaAnalysis,
  budget: CompactMediaTextBudget = DEFAULT_COMPACT_BUDGET
): string {
  const warningBlock =
    analysis.warnings.length > 0 ? `${SECTION_WARNINGS}\n${analysis.warnings.map((w) => `- ${w}`).join('\n')}` : ''

  const audioLines = analysis.audio ? formatAudioSegments(analysis.audio.segments) : []
  const visualLines = formatVisualSummaries(analysis.visuals ?? [])
  const ocrLines = formatOcrLines(analysis.visuals ?? [])

  type Section = { title: string; lines: string[]; empty: string }
  const wanted: Section[] = []
  if (audioLines.length > 0 || analysis.audio || analysis.source.hasAudio) {
    wanted.push({
      title: SECTION_AUDIO,
      lines: audioLines,
      empty: analysis.audio
        ? '(no speech)'
        : analysis.source.hasAudio
          ? '(audio transcription unavailable)'
          : '(no audio track)'
    })
  }
  if (visualLines.length > 0 || analysis.source.hasVideo) {
    wanted.push({ title: SECTION_VISUAL, lines: visualLines, empty: '(no visual summaries)' })
  }
  if (ocrLines.length > 0 || analysis.source.hasVideo) {
    wanted.push({ title: SECTION_OCR, lines: ocrLines, empty: '(no on-screen text)' })
  }

  const separator = '\n\n'
  const headerCost = (title: string) => title.length + 1 // title + newline before body
  const fixed =
    wanted.reduce((sum, section) => sum + headerCost(section.title), 0) +
    Math.max(0, wanted.length - 1) * separator.length +
    (warningBlock ? separator.length + warningBlock.length : 0)
  const bodyBudget = Math.max(0, budget.maxChars - fixed)
  const share = wanted.length > 0 ? Math.floor(bodyBudget / wanted.length) : 0

  const sections: string[] = []
  let remainingBody = bodyBudget
  for (const section of wanted) {
    const allowance = Math.min(share, remainingBody)
    const body = section.lines.length > 0 ? truncateLines(section.lines, allowance) : section.empty.slice(0, allowance)
    sections.push(`${section.title}\n${body}`)
    remainingBody = Math.max(0, remainingBody - body.length)
  }

  if (warningBlock) sections.push(warningBlock)
  const text = sections.join(separator).trim()
  if (text.length <= budget.maxChars) return text
  return text.slice(0, budget.maxChars)
}

function truncateLines(lines: string[], maxChars: number): string {
  if (maxChars <= 0) return ''
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const next = used === 0 ? line.length : used + 1 + line.length
    if (next > maxChars) {
      if (out.length === 0) return line.slice(0, maxChars)
      out.push('…')
      break
    }
    out.push(line)
    used = next
  }
  return out.join('\n')
}

export function isMediaAnalysis(value: unknown): value is MediaAnalysis {
  if (!value || typeof value !== 'object') return false
  const candidate = value as MediaAnalysis
  return (
    candidate.version === MEDIA_ANALYSIS_VERSION &&
    !!candidate.source &&
    typeof candidate.source.mime === 'string' &&
    typeof candidate.source.durationMs === 'number' &&
    typeof candidate.source.hasAudio === 'boolean' &&
    typeof candidate.source.hasVideo === 'boolean' &&
    Array.isArray(candidate.warnings)
  )
}
