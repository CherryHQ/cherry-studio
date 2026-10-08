import { describe, expect, it } from 'vitest'

import { classifyFfprobeResult, planFrameTimestamps, sniffEbmlDocType } from '../probeClassification'

describe('classifyFfprobeResult', () => {
  it('does not classify attached cover art as video', () => {
    expect(
      classifyFfprobeResult({
        format: { duration: '180.5', format_name: 'mp3' },
        streams: [
          { codec_type: 'audio', duration: '180.5' },
          { codec_type: 'video', disposition: { attached_pic: 1 } }
        ]
      })
    ).toEqual({ durationMs: 180_500, hasAudio: true, hasVideo: false, mime: 'audio/mpeg', kind: 'audio' })
  })

  it('uses EBML DocType ahead of the ambiguous matroska,webm format name', () => {
    const probe = {
      format: { duration: '12', format_name: 'matroska,webm' },
      streams: [{ codec_type: 'video' }, { codec_type: 'audio' }]
    }
    expect(classifyFfprobeResult(probe, { ebmlDocType: 'webm' }).mime).toBe('video/webm')
    expect(classifyFfprobeResult(probe, { ebmlDocType: 'matroska' }).mime).toBe('video/x-matroska')
  })

  it('sniffs WebM and Matroska DocType elements from bounded headers', () => {
    expect(sniffEbmlDocType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, ...Buffer.from('webm')]))).toBe(
      'webm'
    )
    expect(sniffEbmlDocType(Buffer.from([0x42, 0x82, 0x88, ...Buffer.from('matroska')]))).toBe('matroska')
  })

  it('falls back across stream durations and rejects non-finite values', () => {
    expect(
      classifyFfprobeResult({
        format: { duration: 'N/A', format_name: 'wav' },
        streams: [{ codec_type: 'audio', duration: '1.25' }]
      }).durationMs
    ).toBe(1250)
    expect(
      classifyFfprobeResult({
        format: { duration: 'Infinity', format_name: 'wav' },
        streams: [{ codec_type: 'audio', duration: 'invalid' }]
      }).durationMs
    ).toBe(0)
  })
})

describe('planFrameTimestamps', () => {
  it('caps evenly spaced timestamps inside the media duration', () => {
    const timestamps = planFrameTimestamps(60_000, 5, 4_000)
    expect(timestamps).toHaveLength(5)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBe(59_950)
    expect(timestamps.every((timestamp) => timestamp >= 0 && timestamp < 60_000)).toBe(true)
  })

  it('returns no timestamps for invalid duration or capacity', () => {
    expect(planFrameTimestamps(Number.NaN, 8, 4_000)).toEqual([])
    expect(planFrameTimestamps(0, 8, 4_000)).toEqual([])
    expect(planFrameTimestamps(1_000, 0, 4_000)).toEqual([])
  })
})
