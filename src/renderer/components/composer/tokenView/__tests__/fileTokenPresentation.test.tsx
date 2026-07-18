import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { describe, expect, it } from 'vitest'

import { getFileTokenPresentation } from '../fileTokenPresentation'

function imageAttachment(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
  return {
    fileTokenSourceId: 'source-1',
    path: '/tmp/image.png',
    name: 'image.png',
    origin_name: 'image.png',
    ext: '.png',
    size: 1,
    type: FILE_TYPE.IMAGE,
    ...overrides
  }
}

describe('getFileTokenPresentation image previewUrl', () => {
  it('degrades to no preview instead of throwing on a malformed percent-encoded file: previewUrl', () => {
    // `new URL()` accepts `file:///tmp/100%.png`, but fileUrlToPath's
    // decodeURIComponent throws URIError on the dangling `%`. The whole conversion
    // stays inside the render guard, so a bad previewUrl degrades rather than
    // aborting the ComposerToken render.
    expect(() => getFileTokenPresentation(imageAttachment(), 'image', 'file:///tmp/100%.png')).not.toThrow()
    expect(getFileTokenPresentation(imageAttachment(), 'image', 'file:///tmp/100%.png').previewUrl).toBeUndefined()
  })

  it('passes a non-file previewUrl through unchanged', () => {
    const result = getFileTokenPresentation(imageAttachment(), 'image', 'https://example.com/a.png')
    expect(result.previewUrl).toBe('https://example.com/a.png')
  })
})
