import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'

import { createFilePreviewRegistry, filePreviewRegistry, resolveExtensionPlugin } from '../filePreviewRegistry'
import type { FilePreviewPlugin, FilePreviewPluginProps } from '../types'

const Preview: ComponentType<FilePreviewPluginProps> = () => null

function plugin(id: string, extensions: readonly string[]): FilePreviewPlugin {
  return {
    id,
    extensions,
    load: async () => ({ default: Preview })
  }
}

describe('file preview registry', () => {
  it.each(['JPG', 'JPEG', 'PNG', 'GIF', 'BMP', 'WEBP'])('registers the image plugin for .%s files', (extension) => {
    expect(resolveExtensionPlugin(`/tmp/image.${extension}`, filePreviewRegistry)?.id).toBe('image')
  })

  it('does not register SVG as a raster image preview', () => {
    expect(resolveExtensionPlugin('/tmp/image.svg', filePreviewRegistry)).toBeNull()
  })

  it('matches file extensions case-insensitively', () => {
    const pdf = plugin('pdf', ['pdf'])
    const registry = createFilePreviewRegistry({ extensionPlugins: [pdf] })

    expect(resolveExtensionPlugin('/tmp/REPORT.PDF', registry)).toBe(pdf)
  })

  it('returns null when the production-style registry is empty', () => {
    const registry = createFilePreviewRegistry({ extensionPlugins: [] })

    expect(resolveExtensionPlugin('/tmp/report.pdf', registry)).toBeNull()
  })

  it('rejects duplicate extensions instead of relying on registration order', () => {
    expect(() =>
      createFilePreviewRegistry({
        extensionPlugins: [plugin('first', ['pdf']), plugin('second', ['pdf'])]
      })
    ).toThrow('Duplicate file preview extension: pdf')
  })

  it.each(['.pdf', 'PDF', ' pdf '])('rejects non-canonical plugin extension %j', (extension) => {
    expect(() => createFilePreviewRegistry({ extensionPlugins: [plugin('pdf', [extension])] })).toThrow(
      `Invalid file preview extension: ${extension}`
    )
  })
})
