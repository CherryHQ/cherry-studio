import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { pdfjsHandlers } from '../pdfjs'

// Point app.root at this repository so the handler resolves the real pdfjs-dist
// bundle under node_modules, exactly like a development run does. The unified
// application mock cannot serve this: its getPath returns /mock/<key>, while
// these tests read real bytes off disk.
const { getPathMock } = vi.hoisted(() => ({ getPathMock: vi.fn() }))
vi.mock('@application', () => ({ application: { getPath: getPathMock } }))

beforeAll(() => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
  getPathMock.mockImplementation((key: string) => {
    if (key === 'app.root') return repoRoot
    throw new Error(`Unexpected application.getPath key in test: ${key}`)
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
