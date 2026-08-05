import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'

import { createFilePreviewRegistry, filePreviewRegistry, resolveExtensionPlugin } from '../filePreviewRegistry'
import { textFilePreviewPlugin } from '../plugins/text/textFilePreviewPlugin'
import type { FilePreviewPlugin, FilePreviewPluginProps } from '../types'

const Preview: ComponentType<FilePreviewPluginProps> = () => null
const TEXT_PREVIEW_EXTENSIONS = [
  'txt',
  'log',
  'json',
  'jsonc',
  'jsonl',
  'yaml',
  'yml',
  'xml',
  'toml',
  'ini',
  'conf',
  'config',
  'properties',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
  'css',
  'scss',
  'sass',
  'less',
  'py',
  'pyw',
  'rb',
  'php',
  'java',
  'kt',
  'kts',
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'hxx',
  'cs',
  'go',
  'rs',
  'swift',
  'dart',
  'lua',
  'r',
  'scala',
  'groovy',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'psm1',
  'bat',
  'cmd',
  'sql',
  'graphql',
  'gql',
  'proto',
  'vue',
  'svelte',
  'astro',
  'diff',
  'patch'
] as const

function plugin(id: string, extensions: readonly string[]): FilePreviewPlugin {
  return {
    id,
    extensions,
    load: async () => ({ default: Preview })
  }
}

describe('file preview registry', () => {
  it.each(['JPG', 'JPEG', 'PNG', 'GIF', 'BMP', 'WEBP', 'AVIF', 'ICO', 'SVG'])(
    'registers the image plugin for .%s files',
    (extension) => {
      expect(resolveExtensionPlugin(`/tmp/image.${extension}`, filePreviewRegistry)?.id).toBe('image')
    }
  )

  it('registers the PDF plugin', () => {
    const extension = 'pdf'
    expect(resolveExtensionPlugin(`/tmp/report.${extension}`, filePreviewRegistry)?.id).toBe('pdf')
  })

  it('registers the Word plugin', () => {
    const extension = 'docx'
    expect(resolveExtensionPlugin(`/tmp/report.${extension}`, filePreviewRegistry)?.id).toBe('word')
  })

  it('registers the PowerPoint plugin', () => {
    const extension = 'pptx'
    expect(resolveExtensionPlugin(`/tmp/slides.${extension}`, filePreviewRegistry)?.id).toBe('powerpoint')
  })

  it.each(['html', 'htm'])('registers the HTML plugin for .%s files', (extension) => {
    expect(resolveExtensionPlugin(`/tmp/page.${extension}`, filePreviewRegistry)?.id).toBe('html')
  })

  it.each(['md', 'markdown', 'mdx'])('registers the Markdown plugin for .%s files', (extension) => {
    expect(resolveExtensionPlugin(`/tmp/readme.${extension}`, filePreviewRegistry)?.id).toBe('markdown')
  })

  it('keeps the text plugin extension whitelist explicit', () => {
    expect(textFilePreviewPlugin.extensions).toEqual(TEXT_PREVIEW_EXTENSIONS)
  })

  it('does not route an unknown extension through the registry', () => {
    expect(resolveExtensionPlugin('/tmp/source.unknown', filePreviewRegistry)).toBeNull()
  })

  it('matches text extensions case-insensitively', () => {
    expect(resolveExtensionPlugin('/tmp/source.JSON', filePreviewRegistry)?.id).toBe('text')
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
