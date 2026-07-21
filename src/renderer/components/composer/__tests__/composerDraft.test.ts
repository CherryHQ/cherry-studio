import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import {
  createComposerDocumentContent,
  createComposerMessageSnapshot,
  createComposerUserMessageParts,
  serializeComposerDocument,
  trimComposerDraftBoundaryBlankLines
} from '../composerDraft'
import { COMPOSER_TOKEN_NODE_NAME } from '../ComposerTokenNode'

function tokenNode(attrs: Record<string, unknown>): JSONContent {
  return {
    type: COMPOSER_TOKEN_NODE_NAME,
    attrs
  }
}

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
