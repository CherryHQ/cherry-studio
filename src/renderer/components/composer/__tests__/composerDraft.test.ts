import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import {
  COMPOSER_INPUT_MAX_LENGTH,
  createComposerDocumentContent,
  createComposerDraftContent,
  createComposerMessageSnapshot,
  createComposerUserMessageParts,
  excludeComposerDraftTokens,
  hasComposerDraftUserText,
  serializeComposerDocument,
  trimComposerDraftBoundaryBlankLines,
  withComposerDraftUserText
} from '../composerDraft'
import { COMPOSER_TOKEN_NODE_NAME } from '../ComposerTokenNode'

function tokenNode(attrs: Record<string, unknown>): JSONContent {
  return {
    type: COMPOSER_TOKEN_NODE_NAME,
    attrs
  }
}

describe('excludeComposerDraftTokens', () => {
  it('removes an excluded token together with its prompt text and rebases later offsets', () => {
    const draft = excludeComposerDraftTokens(
      {
        text: 'before ATTACHED between QUOTED after',
        tokens: [
          { id: 'kb', kind: 'knowledge', label: 'Base', promptText: 'ATTACHED', index: 0, textOffset: 7 },
          { id: 'q', kind: 'quote', label: 'Quote', promptText: 'QUOTED', index: 1, textOffset: 24 }
        ]
      },
      (token) => token.kind === 'knowledge'
    )

    // 'ATTACHED' plus the separator space the editor inserts after a chip.
    expect(draft.text).toBe('before between QUOTED after')
    expect(draft.tokens).toEqual([
      { id: 'q', kind: 'quote', label: 'Quote', promptText: 'QUOTED', index: 0, textOffset: 15 }
    ])
    expect(draft.text.slice(15, 21)).toBe('QUOTED')
  })

  it('leaves the text alone when the prompt text no longer sits at the recorded offset', () => {
    const draft = excludeComposerDraftTokens(
      {
        text: 'user edited the sentence away',
        tokens: [{ id: 'kb', kind: 'knowledge', label: 'Base', promptText: 'ATTACHED', index: 0, textOffset: 5 }]
      },
      (token) => token.kind === 'knowledge'
    )

    expect(draft).toEqual({ text: 'user edited the sentence away', tokens: [] })
  })

  it('rebases a surviving token across several removed spans', () => {
    const draft = excludeComposerDraftTokens(
      {
        text: 'AAA keep BBB tail',
        tokens: [
          { id: 'kb-1', kind: 'knowledge', label: 'One', promptText: 'AAA', index: 0, textOffset: 0 },
          { id: 'q', kind: 'quote', label: 'Quote', promptText: 'keep', index: 1, textOffset: 4 },
          { id: 'kb-2', kind: 'knowledge', label: 'Two', promptText: 'BBB', index: 2, textOffset: 9 }
        ]
      },
      (token) => token.kind === 'knowledge'
    )

    expect(draft.text).toBe('keep tail')
    expect(draft.tokens).toEqual([
      { id: 'q', kind: 'quote', label: 'Quote', promptText: 'keep', index: 0, textOffset: 0 }
    ])
    expect(draft.text.slice(0, 4)).toBe('keep')
  })

  it('collapses a surviving token that sat inside a removed span to where that span started', () => {
    // Reachable when the user deletes the separator space between two chips, leaving the second one
    // parked at the first one's end. Its offset must still land inside the spliced text.
    const draft = excludeComposerDraftTokens(
      {
        text: 'ATTACHED tail',
        tokens: [
          { id: 'kb', kind: 'knowledge', label: 'Base', promptText: 'ATTACHED', index: 0, textOffset: 0 },
          { id: 'f', kind: 'file', label: 'a.md', index: 1, textOffset: 8 }
        ]
      },
      (token) => token.kind === 'knowledge'
    )

    expect(draft.text).toBe('tail')
    expect(draft.tokens).toEqual([{ id: 'f', kind: 'file', label: 'a.md', index: 0, textOffset: 0 }])
  })

  it('returns the same draft when nothing matches', () => {
    const draft = {
      text: 'hello',
      tokens: [{ id: 'f', kind: 'file' as const, label: 'a.md', index: 0, textOffset: 0 }]
    }

    expect(excludeComposerDraftTokens(draft, (token) => token.kind === 'knowledge')).toBe(draft)
  })
})

describe('composer draft serialization', () => {
  it('trims only boundary blank lines while preserving meaningful-line whitespace and internal blank lines', () => {
    const draft = trimComposerDraftBoundaryBlankLines({
      text: ' \t\n  first line  \n\nlast line \t\n \t\n',
      tokens: []
    })

    expect(draft).toEqual({
      text: '  first line  \n\nlast line \t',
      tokens: []
    })
  })

  it('keeps token-only boundary lines and shifts token offsets past removed blank lines', () => {
    const draft = trimComposerDraftBoundaryBlankLines({
      text: '\n\nbody\n\n',
      tokens: [
        { id: 'leading-skill', kind: 'skill', label: 'Browser', index: 0, textOffset: 1 },
        { id: 'trailing-file', kind: 'file', label: 'notes.md', index: 1, textOffset: 8 }
      ]
    })

    expect(draft).toEqual({
      text: '\nbody\n\n',
      tokens: [
        { id: 'leading-skill', kind: 'skill', label: 'Browser', index: 0, textOffset: 0 },
        { id: 'trailing-file', kind: 'file', label: 'notes.md', index: 1, textOffset: 7 }
      ]
    })
  })

  it('preserves trailing blank lines owned by multiline token prompt text', () => {
    const draft = trimComposerDraftBoundaryBlankLines({
      text: '\nvalue\n\n',
      tokens: [
        {
          id: 'prompt-variable:0:value',
          kind: 'promptVariable',
          label: 'value',
          index: 0,
          textOffset: 1,
          promptText: 'value\n\n'
        }
      ]
    })

    expect(draft).toEqual({
      text: 'value\n\n',
      tokens: [
        {
          id: 'prompt-variable:0:value',
          kind: 'promptVariable',
          label: 'value',
          index: 0,
          textOffset: 0,
          promptText: 'value\n\n'
        }
      ]
    })
  })

  it('still trims trailing blank lines outside token prompt text', () => {
    const draft = trimComposerDraftBoundaryBlankLines({
      text: '\nvalue\n\n',
      tokens: [
        {
          id: 'prompt-variable:0:value',
          kind: 'promptVariable',
          label: 'value',
          index: 0,
          textOffset: 1,
          promptText: 'value'
        }
      ]
    })

    expect(draft).toEqual({
      text: 'value',
      tokens: [
        {
          id: 'prompt-variable:0:value',
          kind: 'promptVariable',
          label: 'value',
          index: 0,
          textOffset: 0,
          promptText: 'value'
        }
      ]
    })
  })

  it('collapses a draft containing only token-free blank lines to empty text', () => {
    expect(trimComposerDraftBoundaryBlankLines({ text: ' \t\n\n ', tokens: [] })).toEqual({ text: '', tokens: [] })
  })

  it('serializes tokens before, between, and after text in document order', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            tokenNode({ id: 'browser', kind: 'skill', label: 'Browser', payload: { skillId: 'browser' } }),
            { type: 'text', text: ' open ' },
            tokenNode({ id: 'docs-reference', kind: 'reference', label: 'Docs' }),
            { type: 'text', text: ' edit ' },
            tokenNode({
              id: 'chat.ts',
              kind: 'file',
              label: 'chat.ts',
              promptText: 'src/chat.ts',
              payload: { path: 'src/chat.ts' }
            })
          ]
        }
      ]
    })

    expect(draft.text).toBe(' open  edit src/chat.ts')
    expect(draft.tokens).toMatchObject([
      { id: 'browser', kind: 'skill', label: 'Browser', index: 0, textOffset: 0 },
      { id: 'docs-reference', kind: 'reference', label: 'Docs', index: 1, textOffset: 6 },
      { id: 'chat.ts', kind: 'file', label: 'chat.ts', index: 2, textOffset: 12 }
    ])
  })

  it('does not leak token labels into prompt text by default', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Use ' },
            tokenNode({ id: 'reference:docs', kind: 'reference', label: 'Docs' }),
            { type: 'text', text: ' please' }
          ]
        }
      ]
    })

    expect(draft.text).toBe('Use  please')
    expect(draft.tokens[0]).toMatchObject({ kind: 'reference', label: 'Docs', textOffset: 4 })
  })

  it('keeps plain pasted text as text, not tokens', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Browser 电脑 chat.ts' }]
        }
      ]
    })

    expect(draft).toEqual({ text: 'Browser 电脑 chat.ts', tokens: [] })
  })

  it('creates a display-only composer snapshot with safe file payload metadata', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Open ' },
            tokenNode({
              id: 'file-1',
              kind: 'file',
              label: 'chat.ts',
              promptText: 'src/chat.ts',
              payload: {
                id: 'file-1',
                path: 'src/chat.ts',
                type: 'text',
                ext: '.ts',
                name: 'chat.ts',
                origin_name: 'chat.ts',
                size: 1234,
                extra: 'ignored'
              }
            })
          ]
        }
      ]
    })

    expect(createComposerMessageSnapshot(draft)).toEqual({
      version: 1,
      tokens: [
        {
          id: 'file-1',
          kind: 'file',
          label: 'chat.ts',
          index: 0,
          textOffset: 5,
          promptText: 'src/chat.ts',
          payload: {
            type: 'text',
            ext: '.ts',
            name: 'chat.ts',
            origin_name: 'chat.ts',
            size: 1234
          }
        }
      ]
    })
  })

  it('persists document file payload metadata for sent-message token rendering', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            tokenNode({
              id: 'file-pdf',
              kind: 'file',
              label: 'test.pdf',
              promptText: 'test.pdf',
              payload: {
                type: 'document',
                ext: '.pdf',
                name: 'test.pdf',
                origin_name: 'test.pdf',
                size: 2048
              }
            })
          ]
        }
      ]
    })

    expect(createComposerMessageSnapshot(draft)?.tokens[0]).toMatchObject({
      id: 'file-pdf',
      kind: 'file',
      label: 'test.pdf',
      payload: {
        type: 'document',
        ext: '.pdf',
        name: 'test.pdf',
        origin_name: 'test.pdf',
        size: 2048
      }
    })
  })

  it('serializes and restores folder tokens with path prompt text', () => {
    const folderPath = '/Users/jd/Notes/Project Notes'
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Open ' },
            tokenNode({
              id: 'folder-1',
              kind: 'folder',
              label: 'Project Notes',
              description: folderPath,
              promptText: folderPath
            }),
            { type: 'text', text: ' today' }
          ]
        }
      ]
    })

    expect(draft.text).toBe(`Open ${folderPath} today`)
    expect(createComposerMessageSnapshot(draft)).toEqual({
      version: 1,
      tokens: [
        {
          id: 'folder-1',
          kind: 'folder',
          label: 'Project Notes',
          description: folderPath,
          index: 0,
          textOffset: 5,
          promptText: folderPath
        }
      ]
    })

    expect(createComposerDocumentContent(`Open ${folderPath} today`, createComposerMessageSnapshot(draft))).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Open ' },
            tokenNode({
              id: 'folder-1',
              kind: 'folder',
              label: 'Project Notes',
              description: folderPath,
              promptText: folderPath
            }),
            { type: 'text', text: ' today' }
          ]
        }
      ]
    })
  })

  it('serializes and restores link tokens with the original URL', () => {
    const url = 'https://www.example.com/docs'
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            tokenNode({
              id: 'link-token-1',
              kind: 'link',
              label: 'example.com/docs',
              promptText: url
            })
          ]
        }
      ]
    })

    expect(draft.text).toBe(url)
    expect(createComposerDocumentContent(url, createComposerMessageSnapshot(draft))).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            tokenNode({
              id: 'link-token-1',
              kind: 'link',
              label: 'example.com/docs',
              promptText: url
            })
          ]
        }
      ]
    })
  })

  it('does not persist non-file composer token payload objects', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            tokenNode({ id: 'skill-1', kind: 'skill', label: 'Browser', payload: { filename: 'browser.md' } }),
            { type: 'text', text: ' and ' },
            tokenNode({ id: 'kb-1', kind: 'knowledge', label: 'Docs', payload: { id: 'kb-1' } })
          ]
        }
      ]
    })

    expect(createComposerMessageSnapshot(draft)?.tokens).toEqual([
      { id: 'skill-1', kind: 'skill', label: 'Browser', index: 0, textOffset: 0 },
      { id: 'kb-1', kind: 'knowledge', label: 'Docs', index: 1, textOffset: 5 }
    ])
  })

  it('serializes reference tokens with inlined context prompt text and persists them without payload', () => {
    const promptText = '<referenced-conversation type="topic" name="Docs">\n[user]\nhi\n</referenced-conversation>'
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            tokenNode({
              id: 'reference:topic:t1',
              kind: 'reference',
              label: 'Docs',
              description: 'Docs · Assistant',
              promptText,
              payload: { entityType: 'topic', id: 't1', name: 'Docs' }
            })
          ]
        }
      ]
    })

    expect(draft.text).toBe(`See ${promptText}`)
    const snapshot = createComposerMessageSnapshot(draft)
    expect(snapshot).toEqual({
      version: 1,
      tokens: [
        {
          id: 'reference:topic:t1',
          kind: 'reference',
          label: 'Docs',
          description: 'Docs · Assistant',
          index: 0,
          textOffset: 4,
          promptText
        }
      ]
    })

    expect(createComposerDocumentContent(draft.text, snapshot)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            tokenNode({
              id: 'reference:topic:t1',
              kind: 'reference',
              label: 'Docs',
              description: 'Docs · Assistant',
              promptText
            })
          ]
        }
      ]
    })
  })

  it('serializes quote tokens as blockquote prompt text and persists quote metadata', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Follow up on ' },
            tokenNode({
              id: 'quote-1',
              kind: 'quote',
              label: 'Quote',
              description: 'Selected message text',
              promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
            })
          ]
        }
      ]
    })

    expect(draft.text).toBe('Follow up on <blockquote>\n\nSelected message text\n</blockquote>')
    expect(createComposerMessageSnapshot(draft)).toEqual({
      version: 1,
      tokens: [
        {
          id: 'quote-1',
          kind: 'quote',
          label: 'Quote',
          description: 'Selected message text',
          index: 0,
          textOffset: 13,
          promptText: '<blockquote>\n\nSelected message text\n</blockquote>'
        }
      ]
    })
  })

  it('restores quote tokens from persisted composer metadata without leaking prompt text or separator whitespace', () => {
    const content = createComposerDocumentContent('<blockquote>\n\nSelected message text\n</blockquote> Reply', {
      version: 1,
      tokens: [
        {
          id: 'quote-1',
          kind: 'quote',
          label: 'Quote',
          description: 'Selected message text',
          index: 0,
          textOffset: 0,
          promptText: '<blockquote>\n\nSelected message text\n</blockquote>'
        }
      ]
    })

    expect(content).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            tokenNode({
              id: 'quote-1',
              kind: 'quote',
              label: 'Quote',
              description: 'Selected message text',
              promptText: '<blockquote>\n\nSelected message text\n</blockquote>',
              payload: { restoredTextSuffix: ' ' }
            }),
            { type: 'text', text: 'Reply' }
          ]
        }
      ]
    })

    expect(serializeComposerDocument(content).text).toBe('<blockquote>\n\nSelected message text\n</blockquote> Reply')
  })

  it('drops stale token metadata when composer prompt metadata no longer matches', () => {
    const content = createComposerDocumentContent('Edited selected message Reply', {
      version: 1,
      tokens: [
        {
          id: 'quote-1',
          kind: 'quote',
          label: 'Quote',
          description: 'Selected message text',
          index: 0,
          textOffset: 0,
          promptText: '<blockquote>\n\nSelected message text\n</blockquote>'
        }
      ]
    })

    expect(content).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Edited selected message Reply' }]
        }
      ]
    })

    expect(serializeComposerDocument(content)).toEqual({ text: 'Edited selected message Reply', tokens: [] })
  })

  it('does not restore unsupported raw composer metadata tokens', () => {
    const content = createComposerDocumentContent('Ask docs', {
      version: 1,
      tokens: [
        { id: 'model-1', kind: 'model', label: 'GPT', index: 0, textOffset: 0 },
        { id: 'mcp-prompt-1', kind: 'mcpPrompt', label: 'Prompt', index: 0, textOffset: 0 },
        { id: 'mcp-resource-1', kind: 'mcpResource', label: 'Resource', index: 1, textOffset: 0 },
        { id: 'environment-1', kind: 'environment', label: 'Computer', index: 2, textOffset: 0 }
      ]
    } as never)

    expect(content).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Ask docs' }]
        }
      ]
    })
    expect(serializeComposerDocument(content)).toEqual({ text: 'Ask docs', tokens: [] })
  })

  it('serializes prompt variable tokens as plain prompt text without persisting composer metadata', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Route from ' },
            tokenNode({
              id: 'prompt-variable:0:from',
              kind: 'promptVariable',
              label: 'from',
              description: '${from}',
              promptText: 'Shanghai',
              payload: { variableName: 'from', raw: '${from}' }
            }),
            { type: 'text', text: ' to Beijing' }
          ]
        }
      ]
    })

    expect(draft.text).toBe('Route from Shanghai to Beijing')
    expect(draft.tokens[0]).toMatchObject({
      id: 'prompt-variable:0:from',
      kind: 'promptVariable',
      label: 'from',
      promptText: 'Shanghai',
      textOffset: 11
    })
    expect(createComposerMessageSnapshot(draft)).toBeUndefined()
  })

  it('builds only the text part with composer metadata (file parts come from the send-time bridge)', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            tokenNode({ id: 'kb-1', kind: 'knowledge', label: 'Docs', payload: { id: 'kb-1' } })
          ]
        }
      ]
    })

    expect(createComposerUserMessageParts(draft)).toEqual([
      {
        type: 'text',
        text: 'Read ',
        providerMetadata: {
          cherry: {
            composer: {
              version: 1,
              tokens: [{ id: 'kb-1', kind: 'knowledge', label: 'Docs', index: 0, textOffset: 5 }]
            }
          }
        }
      }
    ])
  })

  it('builds only a text part for folder tokens', () => {
    const folderPath = '/Users/jd/Notes/Project Notes'
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            tokenNode({
              id: 'folder-1',
              kind: 'folder',
              label: 'Project Notes',
              promptText: folderPath
            })
          ]
        }
      ]
    })

    expect(createComposerUserMessageParts(draft)).toEqual([
      {
        type: 'text',
        text: `Read ${folderPath}`,
        providerMetadata: {
          cherry: {
            composer: {
              version: 1,
              tokens: [
                {
                  id: 'folder-1',
                  kind: 'folder',
                  label: 'Project Notes',
                  index: 0,
                  textOffset: 5,
                  promptText: folderPath
                }
              ]
            }
          }
        }
      }
    ])
  })

  it('builds a bare text part when the draft has no restorable tokens', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Read report' }]
        }
      ]
    })

    expect(createComposerUserMessageParts(draft)).toEqual([
      {
        type: 'text',
        text: 'Read report'
      }
    ])
  })
})

describe('composer draft user text', () => {
  const knowledgePrompt =
    'The user attached knowledge base "Knowledge One" (id: kb-1). Include "kb-1" in kb_search baseIds before answering questions that may depend on this knowledge base, and cite relevant kb_search or kb_read results. Use kb_list only to browse its structure; kb_list output is not retrieved evidence.'
  const skillPrompt = 'Use the review-fast skill.'

  const knowledgeToken = {
    id: 'knowledge:kb-1',
    kind: 'knowledge' as const,
    label: 'Knowledge One',
    promptText: knowledgePrompt,
    index: 0,
    textOffset: 0
  }
  const skillToken = {
    id: 'skill:review-fast',
    kind: 'skill' as const,
    label: 'Review fast',
    promptText: skillPrompt,
    index: 0,
    textOffset: 0
  }

  it('treats chip-only knowledge or skill prompt text as empty user text', () => {
    expect(hasComposerDraftUserText({ text: knowledgePrompt, tokens: [knowledgeToken] })).toBe(false)
    expect(hasComposerDraftUserText({ text: skillPrompt, tokens: [skillToken] })).toBe(false)
    expect(hasComposerDraftUserText({ text: 'already typed', tokens: [] })).toBe(true)
    expect(
      hasComposerDraftUserText({
        text: `${knowledgePrompt} already typed`,
        tokens: [knowledgeToken]
      })
    ).toBe(true)
  })

  it('fills chip-only knowledge and skill drafts without dropping those tokens', () => {
    const knowledgeDraft = withComposerDraftUserText(
      { text: knowledgePrompt, tokens: [knowledgeToken] },
      'Clarify the problem'
    )
    const restoredKnowledge = serializeComposerDocument(createComposerDraftContent(knowledgeDraft))
    expect(restoredKnowledge.tokens).toEqual([
      expect.objectContaining({ id: 'knowledge:kb-1', kind: 'knowledge', promptText: knowledgePrompt })
    ])
    expect(excludeComposerDraftTokens(restoredKnowledge, () => true).text.trim()).toBe('Clarify the problem')

    const skillDraft = withComposerDraftUserText(
      { text: skillPrompt, tokens: [skillToken] },
      'Review the current changes'
    )
    const restoredSkill = serializeComposerDocument(createComposerDraftContent(skillDraft))
    expect(restoredSkill.tokens).toEqual([
      expect.objectContaining({ id: 'skill:review-fast', kind: 'skill', promptText: skillPrompt })
    ])
    expect(excludeComposerDraftTokens(restoredSkill, () => true).text.trim()).toBe('Review the current changes')
  })

  it('keeps suggestion-filled drafts within the composer input limit', () => {
    const existingText = 'x'.repeat(COMPOSER_INPUT_MAX_LENGTH - 3)
    const draft = withComposerDraftUserText(
      {
        text: existingText,
        tokens: [{ id: 'file:notes', kind: 'file', label: 'notes.md', index: 0, textOffset: 0 }]
      },
      'ABCDE'
    )

    expect(draft.text).toBe(`${existingText} AB`)
    expect(draft.text).toHaveLength(COMPOSER_INPUT_MAX_LENGTH)
    expect(draft.tokens).toEqual([{ id: 'file:notes', kind: 'file', label: 'notes.md', index: 0, textOffset: 0 }])
  })
})
