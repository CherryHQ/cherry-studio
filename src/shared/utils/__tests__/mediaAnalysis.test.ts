import { describe, expect, it } from 'vitest'

import type { MediaAnalysis } from '@shared/types/mediaAnalysis'
import { formatMediaAnalysisCompact, formatMediaAnalysisFull, isMediaAnalysis } from '@shared/utils/mediaAnalysis'

const sample = (): MediaAnalysis => ({
  version: 1,
  source: { mime: 'video/webm', durationMs: 120_000, hasAudio: true, hasVideo: true },
  audio: {
    segments: [
      { startMs: 0, endMs: 5_000, text: 'Hello from the start. '.repeat(40) },
      { startMs: 65_000, endMs: 70_000, speaker: 'Alex', text: 'Later speech. '.repeat(40) }
    ]
  },
  visuals: [
    { timestampMs: 0, summary: 'A person stands at a whiteboard.', ocrText: 'Agenda' },
    { timestampMs: 64_000, summary: 'Close-up of a diagram.', ocrText: 'Step 1' }
  ],
  warnings: ['vision_failed']
})

describe('media analysis formatters', () => {
  it('keeps timestamped audio, vision, OCR, and bounded warnings in the full projection', () => {
    const text = formatMediaAnalysisFull(sample())
    expect(text).toContain('[1:05] Alex: Later speech.')
    expect(text).toContain('[1:04] Close-up of a diagram.')
    expect(text).toContain('[0:00] Agenda')
    expect(text).toContain('Some video frames could not be summarized.')
  })

  it('preserves every modality under a compact budget', () => {
    const text = formatMediaAnalysisCompact(sample(), { maxChars: 360 })
    expect(text).toContain('## Audio transcript')
    expect(text).toContain('## Visual scenes')
    expect(text).toContain('## On-screen text')
    expect(text.length).toBeLessThanOrEqual(360)
  })

  it('distinguishes successful silence from unavailable transcription', () => {
    const silent = sample()
    silent.audio = { segments: [] }
    expect(formatMediaAnalysisFull(silent)).toContain('(no speech)')
    delete silent.audio
    expect(formatMediaAnalysisFull(silent)).toContain('(audio transcription unavailable)')
  })
})

describe('isMediaAnalysis', () => {
  it('rejects unknown warning strings so cache reads cannot widen the public contract', () => {
    expect(isMediaAnalysis(sample())).toBe(true)
    expect(isMediaAnalysis({ ...sample(), warnings: ['/private/path leaked'] })).toBe(false)
  })
})
