import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'

import {
  canProduceSelectionReference,
  createFilePreviewRegistry,
  filePreviewRegistry,
  hasRenderedFilePreview,
  resolveExtensionPlugin
} from '../filePreviewRegistry'
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

  it.each(['rtf', 'RTF'])('routes .%s to rich document preview instead of source fallback', (extension) => {
    expect(resolveExtensionPlugin(`/tmp/report.${extension}`, filePreviewRegistry)?.id).toBe('rtf')
    expect(canProduceSelectionReference(`/tmp/report.${extension}`)).toBe(false)
  })

  it('registers the PowerPoint plugin', () => {
    const extension = 'pptx'
    expect(resolveExtensionPlugin(`/tmp/slides.${extension}`, filePreviewRegistry)?.id).toBe('powerpoint')
  })

  it.each(['xlsx', 'XLSX'])('registers the spreadsheet plugin for .%s files', (extension) => {
    expect(resolveExtensionPlugin(`/tmp/workbook.${extension}`, filePreviewRegistry)?.id).toBe('spreadsheet')
  })

  it.each(['mp4', 'webm', 'm4v'])('registers the video plugin for .%s files', (extension) => {
    expect(resolveExtensionPlugin(`/tmp/video.${extension}`, filePreviewRegistry)?.id).toBe('video')
  })

  it.each(['ogg', 'ogv', 'mov', 'avi', 'mkv', 'wmv', 'flv'])(
    'does not claim .%s videos without reliable native playback',
    (extension) => {
      expect(resolveExtensionPlugin(`/tmp/video.${extension}`, filePreviewRegistry)).toBeNull()
    }
  )

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

  it('knows which registered plugins can produce a selection reference', () => {
    expect(canProduceSelectionReference('/tmp/report.docx')).toBe(true)
    expect(canProduceSelectionReference('/tmp/deck.pptx')).toBe(true)
    expect(canProduceSelectionReference('/tmp/paper.pdf')).toBe(true)
    expect(canProduceSelectionReference('/tmp/q1.xlsx')).toBe(true)
    expect(canProduceSelectionReference('/tmp/README.md')).toBe(false)
    expect(canProduceSelectionReference('/tmp/photo.png')).toBe(false)
    expect(canProduceSelectionReference('/tmp/no-extension')).toBe(false)
  })
})

describe('hasRenderedFilePreview', () => {
  it('treats rendered formats as preview-only and plain text as editable', () => {
    for (const path of [
      '/w/README.md',
      '/w/page.html',
      '/w/logo.svg',
      '/w/photo.png',
      '/w/spec.pdf',
      '/w/clip.mp4',
      '/w/flow.mmd',
      '/w/flow.mermaid'
    ]) {
      expect(hasRenderedFilePreview(path)).toBe(true)
    }
    for (const path of ['/w/main.ts', '/w/notes.txt', '/w/config.json', '/w/Makefile']) {
      expect(hasRenderedFilePreview(path)).toBe(false)
    }
  })
})
