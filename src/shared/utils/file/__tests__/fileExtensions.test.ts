import mimeDb from 'mime-db'
import { describe, expect, it } from 'vitest'

import {
  audioExts,
  documentExts,
  imageExts,
  knowledgeFileProcessingExts,
  knowledgeSupportedFileExts,
  videoExts
} from '../fileExtensions'

// These three lists are easy to let drift apart (the original bug: artifact reservation keyed
// off a different list than routing did, so `.xls`'s processed `.md` artifact was never
// reserved). Pin the intended relationships so a future edit to one list can't silently
// reintroduce that class of inconsistency, and pin the deliberate PDF-only narrowing of
// the processing list so it can't be silently widened back.
describe('knowledge file-extension source-of-truth invariants', () => {
  const supported = new Set<string>(knowledgeSupportedFileExts)
  const processing = new Set<string>(knowledgeFileProcessingExts)
  const document = new Set<string>(documentExts)

  it('only processes files the knowledge base also accepts (processing ⊆ supported)', () => {
    const orphanProcessing = knowledgeFileProcessingExts.filter((ext) => !supported.has(ext))
    expect(orphanProcessing).toEqual([])
  })

  it('routes PDFs and nothing else through a document_to_markdown processor', () => {
    expect(knowledgeFileProcessingExts).toEqual(['.pdf'])
  })

  it('keeps legacy .xls accepted and document-classified even though it is no longer processed', () => {
    expect(supported.has('.xls')).toBe(true)
    expect(document.has('.xls')).toBe(true)
    // Read straight through AnydocReader instead of a document_to_markdown processor.
    expect(processing.has('.xls')).toBe(false)
  })

  it('leaves OpenDocument formats unsupported by the knowledge base even though they are documents', () => {
    for (const ext of ['.odt', '.odp', '.ods']) {
      expect(document.has(ext)).toBe(true)
      expect(supported.has(ext)).toBe(false)
      expect(processing.has(ext)).toBe(false)
    }
  })

  it('accepts legacy .ppt without classifying it as an app-wide document', () => {
    expect(supported.has('.ppt')).toBe(true)
    // The external file processor has not been verified for legacy binary PowerPoint.
    expect(processing.has('.ppt')).toBe(false)
    // Deliberately absent from documentExts: that list feeds officeparser on the AI
    // attachment path, which does not handle the legacy binary PowerPoint format.
    expect(document.has('.ppt')).toBe(false)
  })
})

// The media catalogs were once hand-typed literals that silently missed common formats
// (audioExts shipped without .m4a for years). mime-db is the reference for what a media
// extension is: every catalog entry must exist there under the catalog's own type, the
// catalogs must not claim one extension twice, and the common formats users actually
// produce must never regress out of the lists.
describe('media catalogs are grounded in mime-db', () => {
  const extensionsByType = (prefix: string): Set<string> => {
    const exts = new Set<string>()
    for (const [mime, def] of Object.entries(mimeDb as Record<string, { extensions?: string[] }>)) {
      if (!mime.startsWith(`${prefix}/`) || !def.extensions) continue
      for (const ext of def.extensions) exts.add(ext)
    }
    return exts
  }

  it('only contains extensions mime-db registers under the catalog type', () => {
    const catalogs = [
      ['imageExts', 'image', imageExts],
      ['videoExts', 'video', videoExts],
      ['audioExts', 'audio', audioExts]
    ] as const
    const ungrounded: string[] = []
    for (const [name, prefix, exts] of catalogs) {
      const registered = extensionsByType(prefix)
      for (const ext of exts) {
        if (!registered.has(ext.replace(/^\./, ''))) ungrounded.push(`${name}: ${ext}`)
      }
    }
    expect(ungrounded).toEqual([])
  })

  it('claims no extension in more than one media catalog', () => {
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const [name, exts] of [
      ['imageExts', imageExts],
      ['videoExts', videoExts],
      ['audioExts', audioExts]
    ] as const) {
      for (const ext of exts) {
        if (seen.has(ext)) collisions.push(`${ext}: ${seen.get(ext)} + ${name}`)
        else seen.set(ext, name)
      }
    }
    expect(collisions).toEqual([])
  })

  it('covers the common formats users actually produce', () => {
    expect(audioExts).toEqual(expect.arrayContaining(['.m4a', '.opus', '.wma', '.aiff', '.caf', '.mid']))
    expect(imageExts).toEqual(expect.arrayContaining(['.heic', '.heif', '.avif', '.svg', '.tiff', '.psd', '.dng']))
    expect(videoExts).toEqual(expect.arrayContaining(['.webm', '.m4v', '.mov', '.3gp']))
  })
})
