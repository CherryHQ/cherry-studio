import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { classifyFfprobeResult, planFrameTimestamps, sniffEbmlDocType } from '../probeClassification'

describe('classifyFfprobeResult', () => {
  it('treats attached_pic cover art as audio-only, not video', () => {
    const classified = classifyFfprobeResult(
      {
        format: { duration: '180.5', format_name: 'mp3' },
        streams: [
          { codec_type: 'audio', codec_name: 'mp3', duration: '180.5' },
          { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }
        ]
      },
      { fallbackExt: 'mp3' }
    )
    expect(classified.hasAudio).toBe(true)
    expect(classified.hasVideo).toBe(false)
    expect(classified.kind).toBe('audio')
    expect(classified.durationMs).toBe(180_500)
    expect(classified.mime).toBe('audio/mpeg')
  })

  it('classifies webm with a real video stream as video/webm', () => {
    const classified = classifyFfprobeResult(
      {
        format: { duration: '12.0', format_name: 'matroska,webm', tags: { DOCTYPE: 'webm' } },
        streams: [
          { codec_type: 'video', codec_name: 'vp9' },
          { codec_type: 'audio', codec_name: 'opus' }
        ]
      },
      { fallbackExt: 'webm' }
    )
    expect(classified.hasAudio).toBe(true)
    expect(classified.hasVideo).toBe(true)
    expect(classified.kind).toBe('video')
    expect(classified.mime).toBe('video/webm')
  })

  it('does not label matroska/mkv as webm from shared format_name or long_name', () => {
    const classified = classifyFfprobeResult(
      {
        format: {
          duration: '12.0',
          format_name: 'matroska,webm',
          format_long_name: 'Matroska / WebM'
        },
        streams: [{ codec_type: 'video', codec_name: 'h264' }]
      },
      { fallbackExt: 'mkv' }
    )
    expect(classified.mime).toBe('video/x-matroska')
  })

  it('uses EBML DocType sniff over ambiguous format_name', () => {
    const asWebm = classifyFfprobeResult(
      {
        format: { duration: '1', format_name: 'matroska,webm', format_long_name: 'Matroska / WebM' },
        streams: [{ codec_type: 'video', codec_name: 'vp9' }]
      },
      { ebmlDocType: 'webm' }
    )
    const asMkv = classifyFfprobeResult(
      {
        format: { duration: '1', format_name: 'matroska,webm', format_long_name: 'Matroska / WebM' },
        streams: [{ codec_type: 'video', codec_name: 'h264' }]
      },
      { ebmlDocType: 'matroska' }
    )
    expect(asWebm.mime).toBe('video/webm')
    expect(asMkv.mime).toBe('video/x-matroska')
  })

  it('sniffs DocType from real fixture headers', () => {
    const root = join(process.cwd(), '.context/av-verify.n73qfg')
    const webm = sniffEbmlDocType(readFileSync(join(root, 'audio.webm')).subarray(0, 512))
    const mkv = sniffEbmlDocType(readFileSync(join(root, 'video.mkv')).subarray(0, 512))
    expect(webm).toBe('webm')
    expect(mkv).toBe('matroska')
  })

  it('classifies audio-only webm as audio/webm', () => {
    const classified = classifyFfprobeResult(
      {
        format: { duration: '3.25', format_name: 'matroska,webm' },
        streams: [{ codec_type: 'audio', codec_name: 'opus' }]
      },
      { fallbackExt: 'webm' }
    )
    expect(classified.hasAudio).toBe(true)
    expect(classified.hasVideo).toBe(false)
    expect(classified.kind).toBe('audio')
    expect(classified.mime).toBe('audio/webm')
  })

  it('maps raw aac and avi to their own MIME types', () => {
    expect(
      classifyFfprobeResult({
        format: { duration: '1', format_name: 'aac' },
        streams: [{ codec_type: 'audio', codec_name: 'aac' }]
      }).mime
    ).toBe('audio/aac')
    expect(
      classifyFfprobeResult(
        {
          format: { duration: '1', format_name: 'avi' },
          streams: [{ codec_type: 'video', codec_name: 'mpeg4' }]
        },
        { fallbackExt: 'avi' }
      ).mime
    ).toBe('video/x-msvideo')
  })

  it('rejects non-finite durations', () => {
    const classified = classifyFfprobeResult({
      format: { duration: 'N/A', format_name: 'wav' },
      streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', duration: 'inf' }]
    })
    expect(classified.durationMs).toBe(0)
  })
})

describe('planFrameTimestamps', () => {
  it('caps frame count and keeps timestamps inside duration', () => {
    const stamps = planFrameTimestamps(60_000, 5, 4_000)
    expect(stamps).toHaveLength(5)
    expect(stamps[0]).toBe(0)
    expect(stamps.at(-1)!).toBeLessThanOrEqual(60_000 - 50)
    expect(stamps.every((ms) => ms >= 0 && ms < 60_000)).toBe(true)
  })

  it('returns empty for invalid duration', () => {
    expect(planFrameTimestamps(Number.NaN, 8, 4_000)).toEqual([])
    expect(planFrameTimestamps(0, 8, 4_000)).toEqual([])
  })
})
