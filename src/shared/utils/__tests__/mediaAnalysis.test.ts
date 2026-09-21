import { describe, expect, it } from 'vitest'

import type { MediaAnalysis } from '@shared/types/mediaAnalysis'
import { formatMediaAnalysisCompact, formatMediaAnalysisFull, isMediaAnalysis } from '@shared/utils/mediaAnalysis'

const sample = (): MediaAnalysis => ({
  version: 1,
  source: { mime: 'video/webm', durationMs: 120_000, hasAudio: true, hasVideo: true },
  audio: {
    segments: [
      { startMs: 0, endMs: 5_000, text: 'Hello from the start of a long transcript. '.repeat(40) },
      { startMs: 5_000, endMs: 10_000, text: 'More speech that would dominate the budget alone. '.repeat(40) }
    ]
  },
  visuals: [
    { timestampMs: 0, summary: 'A person stands at a whiteboard.', ocrText: 'Agenda' },
    { timestampMs: 4_000, summary: 'Close-up of a diagram.', ocrText: 'Step 1' }
  ],
  warnings: ['Vision model unavailable']
})

describe('formatMediaAnalysisFull', () => {
  it('serializes audio, visual, OCR, and warnings with timestamps', () => {
    const text = formatMediaAnalysisFull(sample())
    expect(text).toContain('## Audio transcript')
    expect(text).toContain('[0:00] Hello from the start')
    expect(text).toContain('## Visual scenes')
    expect(text).toContain('[0:00] A person stands at a whiteboard.')
    expect(text).toContain('## On-screen text')
    expect(text).toContain('[0:04] Step 1')
    expect(text).toContain('## Warnings')
    expect(text).toContain('Vision model unavailable')
  })
})

describe('formatMediaAnalysisCompact', () => {
  it('keeps visual and OCR sections when the transcript is long', () => {
    const text = formatMediaAnalysisCompact(sample(), { maxChars: 2_000 })
    expect(text).toContain('## Visual scenes')
    expect(text).toContain('whiteboard')
    expect(text).toContain('## On-screen text')
    expect(text).toContain('Agenda')
    expect(text.length).toBeLessThanOrEqual(2_000)
  })

  it('keeps all three modalities under a tight budget after reserving headers', () => {
    const text = formatMediaAnalysisCompact(sample(), { maxChars: 300 })
    expect(text).toContain('## Audio transcript')
    expect(text).toContain('## Visual scenes')
    expect(text).toContain('## On-screen text')
    expect(text.length).toBeLessThanOrEqual(300)
  })

  it('distinguishes missing audio analysis from successful empty speech', () => {
    const failedAudio: MediaAnalysis = {
      ...sample(),
      audio: undefined,
      warnings: ['Audio transcription failed or is not configured.']
    }
    expect(formatMediaAnalysisFull(failedAudio)).toContain('(audio transcription unavailable)')
    const silent: MediaAnalysis = {
      ...sample(),
      audio: { segments: [] },
      visuals: undefined,
      source: { mime: 'audio/wav', durationMs: 1000, hasAudio: true, hasVideo: false },
      warnings: []
    }
    expect(formatMediaAnalysisFull(silent)).toContain('(no speech)')
  })

  it('is not a prefix of the full serialization when budgets truncate', () => {
    const analysis = sample()
    const full = formatMediaAnalysisFull(analysis)
    const compact = formatMediaAnalysisCompact(analysis, { maxChars: 800 })
    expect(full.startsWith(compact)).toBe(false)
    // read_file continuation must use offset into FULL text, never compact.length
    expect(full.slice(compact.length, compact.length + 20)).not.toEqual(compact.slice(0, 20))
  })
})

describe('isMediaAnalysis', () => {
  it('accepts versioned analysis objects', () => {
    expect(isMediaAnalysis(sample())).toBe(true)
    expect(isMediaAnalysis({ version: 2 })).toBe(false)
    expect(isMediaAnalysis(null)).toBe(false)
  })
})
