import { describe, expect, it } from 'vitest'

import type { MediaAnalysis } from '@shared/types/mediaAnalysis'
import { formatMediaAnalysisFull } from '@shared/utils/mediaAnalysis'

/**
 * Mirrors MediaPreprocessingService usability rules without spinning services:
 * silent ASR success survives; ASR failure without visuals fails usability;
 * partial speech after a failed ASR path does not count.
 */
function isUsable(analysis: MediaAnalysis, audioOk: boolean): boolean {
  const hasSpeech = (analysis.audio?.segments ?? []).some((s) => s.text.trim())
  const hasVisualContent = (analysis.visuals ?? []).some((v) => Boolean(v.summary?.trim() || v.ocrText?.trim()))
  const silentAudioOk = audioOk && analysis.source.hasAudio && !hasSpeech
  return (audioOk && hasSpeech) || hasVisualContent || silentAudioOk
}

describe('media analysis usability', () => {
  it('treats successful silence as usable even when visuals fail', () => {
    const analysis: MediaAnalysis = {
      version: 1,
      source: { mime: 'video/mp4', durationMs: 2000, hasAudio: true, hasVideo: true },
      audio: { segments: [] },
      warnings: ['No visual summaries or on-screen text could be extracted.']
    }
    expect(isUsable(analysis, true)).toBe(true)
    expect(formatMediaAnalysisFull(analysis)).toContain('(no speech)')
  })

  it('rejects when ASR failed and visuals are empty', () => {
    const analysis: MediaAnalysis = {
      version: 1,
      source: { mime: 'video/mp4', durationMs: 2000, hasAudio: true, hasVideo: true },
      warnings: ['Audio transcription failed or is not configured.', 'Visual preprocessing failed.']
    }
    expect(isUsable(analysis, false)).toBe(false)
    expect(formatMediaAnalysisFull(analysis)).toContain('(audio transcription unavailable)')
  })

  it('accepts vision-only success when ASR failed', () => {
    const analysis: MediaAnalysis = {
      version: 1,
      source: { mime: 'video/mp4', durationMs: 2000, hasAudio: true, hasVideo: true },
      visuals: [{ timestampMs: 0, summary: 'A blue screen' }],
      warnings: ['Audio transcription failed or is not configured.']
    }
    expect(isUsable(analysis, false)).toBe(true)
  })

  it('rejects partial speech when ASR path failed after an earlier chunk', () => {
    const analysis: MediaAnalysis = {
      version: 1,
      source: { mime: 'audio/wav', durationMs: 120_000, hasAudio: true, hasVideo: false },
      // Segments may exist from an earlier successful chunk, but audioOk=false
      // means a later chunk failed and the request must abort for audio-only.
      audio: { segments: [{ startMs: 0, endMs: 60_000, text: 'partial transcript' }] },
      warnings: ['Audio transcription failed or is not configured.']
    }
    expect(isUsable(analysis, false)).toBe(false)
  })
})
