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
