import { MODALITY } from '@cherrystudio/provider-registry'
import type { Model } from '@shared/data/types/model'
import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { resolveMediaCapabilities, stripUnsupportedMedia } from '../messageCapabilities'

const model = (inputModalities: string[]): Model => ({ capabilities: [], inputModalities }) as unknown as Model

const fileMsg = (mediaType: string): UIMessage =>
  ({
    id: 'm',
    role: 'user',
    parts: [{ type: 'file', mediaType, url: 'data:application/octet-stream;base64,AA' }]
  }) as UIMessage

describe('resolveMediaCapabilities', () => {
  it('derives modality flags from the model', () => {
    expect(resolveMediaCapabilities(model([MODALITY.IMAGE]))).toEqual({ image: true, video: false, audio: false })
    expect(resolveMediaCapabilities(model([]))).toEqual({ image: false, video: false, audio: false })
  })
})

describe('stripUnsupportedMedia', () => {
  const noVision = { image: false, video: true, audio: true }

  it('replaces an image file part with a note when the model has no vision', () => {
    const [out] = stripUnsupportedMedia([fileMsg('image/png')], noVision)
    expect(out.parts).toEqual([{ type: 'text', text: expect.stringContaining('image attachment omitted') }])
  })

  it('leaves the part untouched when the modality is supported (same reference)', () => {
    const msg = fileMsg('image/png')
    expect(stripUnsupportedMedia([msg], { image: true, video: true, audio: true })[0]).toBe(msg)
  })

  it('leaves non-gated files (e.g. PDF) untouched', () => {
    const msg = fileMsg('application/pdf')
    expect(stripUnsupportedMedia([msg], noVision)[0]).toBe(msg)
  })

  it('replaces only the unsupported part, keeping the rest', () => {
    const msg = {
      id: 'm',
      role: 'user',
      parts: [
        { type: 'text', text: 'hi' },
        { type: 'file', mediaType: 'image/png', url: 'data:application/octet-stream;base64,AA' }
      ]
    } as UIMessage
    const [out] = stripUnsupportedMedia([msg], noVision)
    expect(out.parts).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'text', text: expect.stringContaining('image attachment omitted') }
    ])
  })
})
