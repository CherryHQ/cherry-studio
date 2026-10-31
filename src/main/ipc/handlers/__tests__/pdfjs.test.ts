import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { pdfjsHandlers } from '../pdfjs'

beforeAll(() => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
  const resourceDirs: Record<string, string> = {
    'feature.pdfjs.cmaps': 'cmaps',
    'feature.pdfjs.standard_fonts': 'standard_fonts'
  }
  vi.mocked(application.getPath).mockImplementation((key, filename) => {
    const resourceDir = resourceDirs[key]
    if (!resourceDir) throw new Error(`Unexpected application.getPath key in test: ${key}`)
    return path.join(repoRoot, 'node_modules', 'pdfjs-dist', resourceDir, filename ?? '')
  })
})

const ctx = { senderId: null }

describe('pdfjs.resource.read', () => {
  it('reads a binary CMap from the packaged bundle', async () => {
    const result = await pdfjsHandlers['pdfjs.resource.read']({ kind: 'cmap', name: 'UniGB-UCS2-H' }, ctx)

    expect(result.content).toBeInstanceOf(Uint8Array)
    expect(result.content.byteLength).toBeGreaterThan(0)
  })

  it('reads a standard font file from the packaged bundle', async () => {
    const result = await pdfjsHandlers['pdfjs.resource.read'](
      { kind: 'standard_font', name: 'LiberationSans-Regular.ttf' },
      ctx
    )

    expect(result.content).toBeInstanceOf(Uint8Array)
    expect(result.content.byteLength).toBeGreaterThan(0)
  })

  it('rejects a relative traversal name even when called past the schema layer', async () => {
    await expect(pdfjsHandlers['pdfjs.resource.read']({ kind: 'cmap', name: '../package' }, ctx)).rejects.toThrow(
      /outside its bundle directory/
    )
  })

  it('rejects an absolute-path name even when called past the schema layer', async () => {
    await expect(pdfjsHandlers['pdfjs.resource.read']({ kind: 'cmap', name: '/etc/passwd' }, ctx)).rejects.toThrow(
      /outside its bundle directory/
    )
  })

  it('rejects an unknown resource name', async () => {
    await expect(
      pdfjsHandlers['pdfjs.resource.read']({ kind: 'cmap', name: 'NoSuchCMapAnywhere' }, ctx)
    ).rejects.toThrow()
  })
})
