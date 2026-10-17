import { describe, expect, it } from 'vitest'

import {
  classifyFfprobeResult,
  planFrameTimestamps,
  relativeInputSeekMs,
  sniffEbmlDocType,
  videoTailProbePoint,
  videoTailReadInterval
} from '../probeClassification'

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

describe('video tail packet seek', () => {
  it('locates the video end and seeks relative to the format start', () => {
    const vfr = videoTailProbePoint({
      format: { duration: '1.002', start_time: '0' },
      streams: [{ codec_type: 'video', start_time: '0', duration: '1.002' }]
    })
    expect(vfr).toEqual({ endSeconds: 1.002, formatStartTimeSeconds: 0 })
    expect(videoTailReadInterval(1.002)).toBe('1.001000%1.003000')
    expect(relativeInputSeekMs(0.002, 0)).toBe(2)

    // Audio at 0, video at 1.5 for 2s. Last PTS 3.4 is 3.4s from the format start, not 1.9s.
    const staggered = videoTailProbePoint({
      streams: [
        { codec_type: 'audio', start_time: '0', duration: '4' },
        { codec_type: 'video', start_time: '1.5', duration: '2.0' }
      ],
      format: { duration: '4', start_time: '0' }
    })
    expect(staggered).toEqual({ endSeconds: 3.5, formatStartTimeSeconds: 0 })
    expect(relativeInputSeekMs(3.4, staggered?.formatStartTimeSeconds ?? Number.NaN)).toBe(3_400)

    const shifted = videoTailProbePoint({
      streams: [{ codec_type: 'video', start_time: '1.5', duration: '2.0' }],
      format: { duration: '2.0', start_time: '1.5' }
    })
    expect(shifted).toEqual({ endSeconds: 3.5, formatStartTimeSeconds: 1.5 })
    expect(relativeInputSeekMs(3.4, 1.5)).toBe(1_900)
  })

  it('uses the video stream duration when audio runs longer, and ignores cover art', () => {
    expect(
      videoTailProbePoint({
        format: { duration: '4', start_time: '0' },
        streams: [
          { codec_type: 'video', start_time: '0', duration: '1' },
          { codec_type: 'audio', duration: '4' }
        ]
      })
    ).toEqual({ endSeconds: 1, formatStartTimeSeconds: 0 })
    expect(
      videoTailProbePoint({
        format: { duration: '4' },
        streams: [{ codec_type: 'video', disposition: { attached_pic: 1 }, duration: '1' }]
      })
    ).toBeUndefined()
    expect(relativeInputSeekMs(Number.NaN, 0)).toBeUndefined()
    expect(relativeInputSeekMs(0.1, 0.2)).toBeUndefined()
  })

  it('pairs a missing video-stream duration with the format start, not the video start', () => {
    expect(
      videoTailProbePoint({
        format: { duration: '4', start_time: '0.2' },
        streams: [{ codec_type: 'video', start_time: '1.5' }]
      })
    ).toEqual({ endSeconds: 4.2, formatStartTimeSeconds: 0.2 })
    expect(
      videoTailProbePoint({
        format: { duration: '4', start_time: '1' },
        streams: [{ codec_type: 'video', start_time: '0' }]
      })
    ).toEqual({ endSeconds: 5, formatStartTimeSeconds: 1 })
  })
})
