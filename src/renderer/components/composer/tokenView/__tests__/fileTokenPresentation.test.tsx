import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { AbsoluteFilePath } from '@shared/types/file'

import { getFileTokenPresentation } from '../fileTokenPresentation'

const iconNameOf = (presentation: { icon: unknown }) =>
  (presentation.icon as ReactElement<{ icon: string }>).props.icon.replace(/^material-icon-theme:/, '')

function imageAttachment(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
  return {
    fileTokenSourceId: 'source-1',
    path: '/tmp/image.png' as AbsoluteFilePath,
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

  // The message-editing round-trip rebuilds attachments from a stored `file://` URL and has no path.
  it('previews a path-less attachment from its own previewUrl', () => {
    const editRoundTrip = imageAttachment({ path: undefined, previewUrl: 'file:///tmp/image.png' })

    expect(getFileTokenPresentation(editRoundTrip, 'image').previewUrl).toBeDefined()
  })
})

describe('getFileTokenPresentation icon', () => {
  const presentationFor = (name: string, file?: Partial<ComposerAttachment>) =>
    getFileTokenPresentation(file && imageAttachment(file), name)

  it('resolves the type icon from the app-wide file icon mapping', () => {
    // The same mapping the file tree, clickable file paths and agent file mentions use, so a token
    // names a `.ts` a TypeScript icon instead of a token-local "code" bucket.
    expect(iconNameOf(presentationFor('agents.ts'))).toBe('typescript')
    expect(iconNameOf(presentationFor('App.tsx'))).toBe('react-ts')
    expect(iconNameOf(presentationFor('main.py'))).toBe('python')
    expect(iconNameOf(presentationFor('archive.zip'))).toBe('zip')
    expect(iconNameOf(presentationFor('clip.mp4'))).toBe('video')
    expect(iconNameOf(presentationFor('notes.md'))).toBe('markdown')
    expect(iconNameOf(presentationFor('Dockerfile'))).toBe('docker')
  })

  it('keeps the generic document glyph for unknown types', () => {
    expect(iconNameOf(presentationFor('mystery.xyz'))).toBe('document')
    expect(iconNameOf(presentationFor(''))).toBe('document')
  })

  it('prefers the attachment file name over the display label', () => {
    const renamed = presentationFor('Renamed label', { origin_name: 'notes.md', name: 'notes.md' })

    expect(iconNameOf(renamed)).toBe('markdown')
  })

  it('sizes the chip icon to the chip slot and the popover icon for the preview card', () => {
    const presentation = presentationFor('notes.md')

    expect((presentation.icon as ReactElement<{ className: string }>).props.className).toBe('size-full shrink-0')
    expect((presentation.previewIcon as ReactElement<{ className: string }>).props.className).toBe('size-7')
  })
})
