import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { type AbsoluteFilePath, FILE_TYPE } from '@shared/types/file'

import { getFileTokenPresentation } from '../fileTokenPresentation'

const iconNameOf = (presentation: { icon: unknown }) => {
  const view = render(presentation.icon as ReactElement)
  const icon = view.getByTestId('iconify-icon').getAttribute('data-icon')
  view.unmount()
  return icon?.replace(/^material-icon-theme:/, '')
}

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

  const variantFor = (name: string) => getFileTokenPresentation(undefined, name).variant

  it('assigns office and archive variants consistently across attachment surfaces', () => {
    expect(variantFor('report.docx')).toBe('word')
    expect(variantFor('report.odt')).toBe('word')
    expect(variantFor('notes.rtf')).toBe('word')
    expect(variantFor('budget.xlsx')).toBe('excel')
    expect(variantFor('budget.ods')).toBe('excel')
    expect(variantFor('data.csv')).toBe('excel')
    expect(variantFor('data.tsv')).toBe('excel')
    expect(variantFor('deck.pptx')).toBe('powerpoint')
    expect(variantFor('deck.odp')).toBe('powerpoint')
    expect(variantFor('book.epub')).toBe('document')
    // Archives, audio and video stay on the generic fallback variant (glyph still
    // distinguishes them via the app-wide icon mapping); see ComposerToken test
    // "keeps unsupported archive, audio, and video extensions on the fallback variant".
    expect(variantFor('archive.zip')).toBe('fallback')
    expect(variantFor('archive.tgz')).toBe('fallback')
    expect(variantFor('mystery.xyz')).toBe('fallback')
  })

  it('prefers the attachment file name over the display label', () => {
    const renamed = presentationFor('Renamed label', { origin_name: 'notes.md', name: 'notes.md' })

    expect(iconNameOf(renamed)).toBe('markdown')
  })
})
