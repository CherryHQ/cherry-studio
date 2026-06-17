import { describe, expect, it } from 'vitest'

import { documentExts, knowledgeFileProcessingExts, knowledgeSupportedFileExts } from '../constant'

// These three lists are easy to let drift apart (the original bug: `.xls` was a knowledge
// processing ext but missing from `documentExts`, so its processed `.md` artifact was never
// reserved). Pin the intended relationships so a future edit to one list can't silently
// reintroduce that class of inconsistency.
describe('knowledge file-extension source-of-truth invariants', () => {
  const supported = new Set<string>(knowledgeSupportedFileExts)
  const processing = new Set<string>(knowledgeFileProcessingExts)
  const document = new Set<string>(documentExts)

  it('only processes files the knowledge base also accepts (processing ⊆ supported)', () => {
    const orphanProcessing = knowledgeFileProcessingExts.filter((ext) => !supported.has(ext))
    expect(orphanProcessing).toEqual([])
  })

  it('treats legacy .xls consistently across supported, processing, and document classification', () => {
    expect(supported.has('.xls')).toBe(true)
    expect(processing.has('.xls')).toBe(true)
    expect(document.has('.xls')).toBe(true)
  })

  it('leaves OpenDocument formats unsupported by the knowledge base even though they are documents', () => {
    for (const ext of ['.odt', '.odp', '.ods']) {
      expect(document.has(ext)).toBe(true)
      expect(supported.has(ext)).toBe(false)
      expect(processing.has(ext)).toBe(false)
    }
  })
})
