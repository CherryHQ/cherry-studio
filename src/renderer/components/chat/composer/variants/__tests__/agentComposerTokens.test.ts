import type { LocalSkill } from '@renderer/types'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { describe, expect, it } from 'vitest'

import {
  agentComposerTokenId,
  agentFileToComposerToken,
  agentSkillToComposerToken,
  getAgentComposerTokenIds
} from '../agentComposerTokens'

describe('agent composer token mapping', () => {
  it('maps files to stable composer token ids', () => {
    const file = {
      fileTokenSourceId: 'source-file-1',
      name: 'agent.ts',
      origin_name: 'agent.ts',
      path: '/tmp/agent.ts'
    } as ComposerAttachment

    expect(agentFileToComposerToken(file)).toMatchObject({
      id: 'file:source-file-1',
      kind: 'file',
      label: 'agent.ts',
      payload: file
    })
  })

  it('uses the unguessable file token source id instead of the file path', () => {
    const file = { fileTokenSourceId: 'source-fallback', path: '/tmp/fallback.txt' } as ComposerAttachment

    expect(agentComposerTokenId.file(file)).toBe('file:source-fallback')
  })

  it('does not create a fixed fallback token id for files without a source id', () => {
    const file = { path: '/tmp/agent.ts' } as ComposerAttachment

    expect(() => agentComposerTokenId.file(file)).toThrow('fileTokenSourceId')
  })

  it('maps skills to prompt-bearing composer tokens', () => {
    const skill = {
      name: 'pdf',
      description: 'Read and analyze PDFs',
      filename: 'pdf'
    } satisfies LocalSkill

    expect(agentSkillToComposerToken(skill)).toEqual({
      id: 'skill:pdf',
      kind: 'skill',
      label: 'pdf',
      description: 'Read and analyze PDFs',
      promptText: 'Use the pdf skill.',
      payload: skill
    })
  })

  it('extracts file token ids by kind', () => {
    const ids = getAgentComposerTokenIds(
      [
        { id: 'file:file-1', kind: 'file', label: 'agent.ts', index: 0, textOffset: 0 },
        { id: 'skill:pdf', kind: 'skill', label: 'pdf', index: 1, textOffset: 0 },
        { id: 'reference:docs', kind: 'reference', label: 'Docs', index: 1, textOffset: 0 }
      ],
      'file'
    )

    expect(ids).toEqual(new Set(['file:file-1']))
  })
})
