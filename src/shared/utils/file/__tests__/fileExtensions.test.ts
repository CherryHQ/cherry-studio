import { describe, expect, it } from 'vitest'

import {
  documentExts,
  knowledgeFileProcessingExts,
  knowledgeIndexableFileExtSet,
  knowledgePlainTextFileExts,
  knowledgeSupportedFileExts
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

  it('indexes every curated reader plus the curated plaintext set', () => {
    for (const ext of knowledgeSupportedFileExts) {
      expect(knowledgeIndexableFileExtSet.has(ext)).toBe(true)
    }
    for (const ext of knowledgePlainTextFileExts) {
      expect(knowledgeIndexableFileExtSet.has(ext)).toBe(true)
    }
    // A representative slice of the curated plaintext additions the feature is about.
    for (const ext of ['.py', '.go', '.rs', '.yaml', '.toml', '.sql', '.sh', '.rst']) {
      expect(knowledgeIndexableFileExtSet.has(ext)).toBe(true)
    }
  })

  it('does not admit binary or no-value extensions by membership (they enter only via explicit opt-in)', () => {
    // The exact extensions the review flagged as binary/ambiguous despite appearing in a text list.
    for (const ext of ['.pkl', '.pt', '.plist', '.stl', '.mat', '.msg', '.obj', '.raw']) {
      expect(knowledgeIndexableFileExtSet.has(ext)).toBe(false)
    }
    // Binary office formats with no local text layer.
    for (const ext of ['.odt', '.odp', '.ods']) {
      expect(knowledgeIndexableFileExtSet.has(ext)).toBe(false)
    }
  })

  it('keeps dotfile-style names off the curated set so the renderer/main classifiers cannot disagree', () => {
    // `.eslintrc`/`.env`/`.bashrc`/`.dockerfile` split-vs-extname differently between renderer and
    // main (a bare-dotfile basename has no `path.extname`); admitting them by name is what lost
    // whole batches to rollback, so none may be curated members.
    const names = [
      '.env',
      '.eslintrc',
      '.bashrc',
      '.npmrc',
      '.gitattributes',
      '.editorconfig',
      '.prettierrc',
      '.dockerfile'
    ]
    for (const name of names) {
      expect(knowledgeIndexableFileExtSet.has(name)).toBe(false)
    }
  })
})
