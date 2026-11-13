import { describe, expect, it } from 'vitest'

import { knowledgeFileProcessingExts, knowledgeSupportedFileExts } from '../fileExtensions'

// These three lists are easy to let drift apart (the original bug: artifact reservation keyed
// off a different list than routing did, so `.xls`'s processed `.md` artifact was never
// reserved). Pin the intended relationships so a future edit to one list can't silently
// reintroduce that class of inconsistency, and pin the deliberate PDF-only narrowing of
// the processing list so it can't be silently widened back.
describe('knowledge file-extension source-of-truth invariants', () => {
  const supported = new Set<string>(knowledgeSupportedFileExts)
  const processing = new Set<string>(knowledgeFileProcessingExts)

  it('only processes files the knowledge base also accepts (processing ⊆ supported)', () => {
    const orphanProcessing = knowledgeFileProcessingExts.filter((ext) => !supported.has(ext))
    expect(orphanProcessing).toEqual([])
  })

  it('accepts OpenDocument and RTF formats through AnydocReader, not a processor', () => {
    for (const ext of ['.odt', '.odp', '.ods', '.rtf']) {
      expect(supported.has(ext)).toBe(true)
      expect(processing.has(ext)).toBe(false)
    }
  })
})
