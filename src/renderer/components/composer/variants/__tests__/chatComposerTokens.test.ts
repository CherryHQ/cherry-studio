import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import {
  chatComposerTokenId,
  fileToComposerToken,
  getComposerTokenIds,
  knowledgeBaseToComposerToken
} from '../chatComposerTokens'

describe('chat composer token mapping', () => {
  it('maps files and knowledge bases to stable composer token ids', () => {
    const file = {
      fileTokenSourceId: 'source-file-1',
      name: 'chat.ts',
      origin_name: 'chat.ts',
      path: '/tmp/chat.ts'
    } as ComposerAttachment
    const knowledgeBase = { id: 'kb-1', name: 'Docs' } as KnowledgeBase

    expect(fileToComposerToken(file)).toMatchObject({
      id: 'file:source-file-1',
      kind: 'file',
      label: 'chat.ts',
      payload: file
    })
    expect(knowledgeBaseToComposerToken(knowledgeBase)).toMatchObject({
      id: 'knowledge:kb-1',
      kind: 'knowledge',
      label: 'Docs',
      payload: knowledgeBase
    })
  })

  it('steers attached knowledge base questions through semantic search, and gives a file no promptText', () => {
    // The pick reaches the model only as this sentence — the `data-knowledge-scope` part is dropped
    // before the model sees the message. The id has to be in it: every kb_* tool addresses a base by
    // id, so without it the model must spend a kb_list call to discover one.
    const promptText = knowledgeBaseToComposerToken({ id: 'kb-1', name: 'Docs' } as KnowledgeBase).promptText

    expect(promptText).toContain('Docs')
    expect(promptText).toContain('kb-1')
    expect(promptText).toContain('kb_search')
    expect(promptText).toContain('baseIds')
    expect(promptText).toMatch(/kb_list.*not.*evidence/i)

    // Files stay zero-width: they travel as real file parts, so a sentence would only duplicate them.
    expect(
      fileToComposerToken({ fileTokenSourceId: 's1', name: 'a.ts' } as ComposerAttachment).promptText
    ).toBeUndefined()
  })

  it('uses the unguessable file token source id instead of the file path', () => {
    const file = { fileTokenSourceId: 'source-fallback', path: '/tmp/fallback.txt' } as ComposerAttachment

    expect(chatComposerTokenId.file(file)).toBe('file:source-fallback')
  })

  it('does not create a fixed fallback token id for files without a source id', () => {
    const file = { path: '/tmp/chat.ts' } as ComposerAttachment

    expect(() => chatComposerTokenId.file(file)).toThrow('fileTokenSourceId')
  })

  it('extracts token ids by kind', () => {
    const ids = getComposerTokenIds(
      [
        { id: 'file:file-1', kind: 'file', label: 'chat.ts', index: 0, textOffset: 0 },
        { id: 'reference:docs', kind: 'reference', label: 'Docs', index: 1, textOffset: 0 }
      ],
      'file'
    )

    expect(ids).toEqual(new Set(['file:file-1']))
  })
})
