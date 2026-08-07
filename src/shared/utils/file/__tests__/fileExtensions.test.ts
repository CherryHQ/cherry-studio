import { describe, expect, it } from 'vitest'

import { documentExts, knowledgeFileProcessingExts, knowledgeSupportedFileExts } from '../fileExtensions'

// These three lists are easy to let drift apart (the original bug: `.xls` was a knowledge
// processing ext but missing from `documentExts`, so its processed `.md` artifact was never
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
