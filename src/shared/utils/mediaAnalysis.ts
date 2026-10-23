import {
  type MediaAnalysis,
  type MediaAnalysisWarningCode,
  type MediaAudioSegment,
  type MediaVisualFrame,
  MEDIA_ANALYSIS_VERSION
} from '@shared/types/mediaAnalysis'

const SECTION_AUDIO = '## Audio transcript'
const SECTION_VISUAL = '## Visual scenes'
const SECTION_OCR = '## On-screen text'
const SECTION_WARNINGS = '## Warnings'

const WARNING_TEXT: Record<MediaAnalysisWarningCode, string> = {
  audio_transcription_failed: 'Audio transcription failed or is not configured.',
  no_speech: 'No speech was detected in the audio track.',
  ocr_failed: 'Some on-screen text could not be extracted.',
  vision_model_unavailable: 'No video vision model is configured.',
  vision_failed: 'Some video frames could not be summarized.',
  visual_analysis_failed: 'Visual analysis failed.',
  no_visual_content: 'No visual summaries or on-screen text could be extracted.'
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function audioLines(segments: MediaAudioSegment[]): string[] {
  return segments.flatMap((segment) => {
    const text = segment.text.trim()
    if (!text) return []
    const speaker = segment.speaker?.trim()
    return [`[${formatTimestamp(segment.startMs)}] ${speaker ? `${speaker}: ` : ''}${text}`]
  })
}

function visualLines(frames: MediaVisualFrame[], field: 'summary' | 'ocrText'): string[] {
  return frames.flatMap((frame) => {
    const text = frame[field]?.trim()
    return text ? [`[${formatTimestamp(frame.timestampMs)}] ${text}`] : []
  })
}

function audioFallback(analysis: MediaAnalysis): string {
  if (!analysis.source.hasAudio) return '(no audio track)'
  return analysis.audio ? '(no speech)' : '(audio transcription unavailable)'
}

export function formatMediaAnalysisFull(analysis: MediaAnalysis): string {
  const audio = audioLines(analysis.audio?.segments ?? [])
  const visuals = visualLines(analysis.visuals ?? [], 'summary')
  const ocr = visualLines(analysis.visuals ?? [], 'ocrText')
  const parts = [
    '# Media analysis',
    `MIME: ${analysis.source.mime}`,
    `Duration: ${formatTimestamp(analysis.source.durationMs)}`,
    `Has audio: ${analysis.source.hasAudio}`,
    `Has video: ${analysis.source.hasVideo}`,
    '',
    SECTION_AUDIO,
    audio.join('\n') || audioFallback(analysis),
    '',
    SECTION_VISUAL,
    visuals.join('\n') || '(no visual summaries)',
    '',
    SECTION_OCR,
    ocr.join('\n') || '(no on-screen text)'
  ]

  if (analysis.warnings.length > 0) {
    parts.push('', SECTION_WARNINGS, ...analysis.warnings.map((warning) => `- ${WARNING_TEXT[warning]}`))
  }
  return parts.join('\n')
}

export interface CompactMediaTextBudget {
  maxChars: number
}

function truncateLines(lines: string[], maxChars: number): string {
  if (maxChars <= 0) return ''
  const output: string[] = []
  let used = 0
  for (const line of lines) {
    const next = used + (output.length > 0 ? 1 : 0) + line.length
    if (next > maxChars) {
      if (output.length === 0) return line.slice(0, maxChars)
      if (used + 2 <= maxChars) output.push('...')
      break
    }
    output.push(line)
    used = next
  }
  return output.join('\n')
}

export function formatMediaAnalysisCompact(
  analysis: MediaAnalysis,
  budget: CompactMediaTextBudget = { maxChars: 12_000 }
): string {
  const sections = [
    { title: SECTION_AUDIO, lines: audioLines(analysis.audio?.segments ?? []), empty: audioFallback(analysis) },
    { title: SECTION_VISUAL, lines: visualLines(analysis.visuals ?? [], 'summary'), empty: '(no visual summaries)' },
    { title: SECTION_OCR, lines: visualLines(analysis.visuals ?? [], 'ocrText'), empty: '(no on-screen text)' }
  ].filter((section) =>
    section.title === SECTION_AUDIO
      ? analysis.source.hasAudio || Boolean(analysis.audio)
      : analysis.source.hasVideo || section.lines.length > 0
  )
  const warning =
    analysis.warnings.length > 0
      ? `${SECTION_WARNINGS}\n${analysis.warnings.map((code) => `- ${WARNING_TEXT[code]}`).join('\n')}`
      : ''
  const fixed =
    sections.reduce((length, section) => length + section.title.length + 1, 0) +
    Math.max(0, sections.length - 1) * 2 +
    (warning ? warning.length + 2 : 0)
  const share = sections.length > 0 ? Math.floor(Math.max(0, budget.maxChars - fixed) / sections.length) : 0
  const output = sections.map(
    ({ title, lines, empty }) => `${title}\n${truncateLines(lines.length > 0 ? lines : [empty], share)}`
  )
  if (warning) output.push(warning)
  return output.join('\n\n').trim().slice(0, budget.maxChars)
}

export function isMediaAnalysis(value: unknown): value is MediaAnalysis {
  if (!value || typeof value !== 'object') return false
  const candidate = value as MediaAnalysis
  return (
    candidate.version === MEDIA_ANALYSIS_VERSION &&
    typeof candidate.source?.mime === 'string' &&
    typeof candidate.source.durationMs === 'number' &&
    typeof candidate.source.hasAudio === 'boolean' &&
    typeof candidate.source.hasVideo === 'boolean' &&
    Array.isArray(candidate.warnings) &&
    candidate.warnings.every((warning) => warning in WARNING_TEXT)
  )
}
