import { readComposerClipboardFragment } from '@renderer/utils/messageUtils/composerClipboard'
import { describe, expect, it } from 'vitest'

import {
  createComposerMarkedTextPasteContent,
  createComposerPlainTextPasteContent,
  getComposerClipboardPasteOverride,
  getComposerPlainTextPasteOverride
} from '../composerPaste'

const resolveSkillMarker = (marker: string) =>
  marker === 'pdf'
    ? {
        id: 'skill:pdf',
        kind: 'skill' as const,
        label: 'PDF',
        promptText: 'Use the PDF skill.'
      }
    : null

const resolveKnowledgeBaseMarker = (marker: string) =>
  marker === 'kb-1' || marker === 'Docs'
    ? {
        id: 'knowledge:kb-1',
        kind: 'knowledge' as const,
        label: 'Docs'
      }
    : null

describe('composer paste handling', () => {
  it('preserves LF newlines as composer hard breaks', () => {
    expect(createComposerPlainTextPasteContent('a\nb')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' }
    ])
  })

  it('normalizes CRLF and CR newlines to composer hard breaks', () => {
    expect(createComposerPlainTextPasteContent('a\r\nb\rc')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' },
      { type: 'hardBreak' },
      { type: 'text', text: 'c' }
    ])
  })

  it('intercepts single-line text paste as plain text content', () => {
    expect(getComposerPlainTextPasteOverride('single line', {})).toEqual([{ type: 'text', text: 'single line' }])
  })

  it('restores mixed prompt variable and slash skill markers in one paste pass', () => {
    expect(
      getComposerPlainTextPasteOverride('Use ${city} with /pdf/\nThen ${date}', {
        promptVariableStartIndex: 2,
        resolveSkillMarker
      })
    ).toEqual([
      { type: 'text', text: 'Use ' },
      {
        type: 'composerToken',
        attrs: {
          id: 'prompt-variable:2:city',
          kind: 'promptVariable',
          label: 'city',
          description: '${city}',
          promptText: '${city}',
          payload: { raw: '${city}', variableName: 'city' }
        }
      },
      { type: 'text', text: ' with ' },
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        }
      },
      { type: 'hardBreak' },
      { type: 'text', text: 'Then ' },
      {
        type: 'composerToken',
        attrs: {
          id: 'prompt-variable:3:date',
          kind: 'promptVariable',
          label: 'date',
          description: '${date}',
          promptText: '${date}',
          payload: { raw: '${date}', variableName: 'date' }
        }
      }
    ])
  })

  it('restores slash skill markers only when a resolver is provided', () => {
    expect(createComposerMarkedTextPasteContent('/pdf/ hello', resolveSkillMarker)).toEqual([
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        }
      },
      { type: 'text', text: ' hello' }
    ])
  })

  it('restores knowledge base markers when a resolver is provided', () => {
    expect(
      getComposerPlainTextPasteOverride('#kb-1# hello', {
        resolveKnowledgeBaseMarker
      })
    ).toEqual([
      {
        type: 'composerToken',
        attrs: {
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Docs'
        }
      },
      { type: 'text', text: ' hello' }
    ])
  })

  it('preserves unresolved knowledge base markers while restoring other markers', () => {
    expect(
      getComposerPlainTextPasteOverride('#missing# #Docs#', {
        resolveKnowledgeBaseMarker
      })
    ).toEqual([
      { type: 'text', text: '#missing# ' },
      {
        type: 'composerToken',
        attrs: {
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Docs'
        }
      }
    ])
  })

  it('keeps slash skill markers as plain text without a resolver', () => {
    expect(getComposerPlainTextPasteOverride('/pdf/ hello', {})).toEqual([{ type: 'text', text: '/pdf/ hello' }])
  })

  it('preserves unresolved slash markers while restoring other markers', () => {
    expect(
      getComposerPlainTextPasteOverride('/missing/ ${city} /pdf/', {
        resolveSkillMarker
      })
    ).toEqual([
      { type: 'text', text: '/missing/ ' },
      {
        type: 'composerToken',
        attrs: {
          id: 'prompt-variable:0:city',
          kind: 'promptVariable',
          label: 'city',
          description: '${city}',
          promptText: '${city}',
          payload: { raw: '${city}', variableName: 'city' }
        }
      },
      { type: 'text', text: ' ' },
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        }
      }
    ])
  })

  it('does not parse skill markers with spaces inside the slashes', () => {
    expect(createComposerMarkedTextPasteContent('/pdf skill/ hello', resolveSkillMarker)).toBeNull()
  })

  it('does not intercept empty text paste', () => {
    expect(getComposerPlainTextPasteOverride('', {})).toBeNull()
  })

  it('downgrades private file tokens with path-only payloads to fallback text', () => {
    const fragment = readComposerClipboardFragment(
      JSON.stringify({
        version: 1,
        segments: [
          {
            type: 'token',
            fallbackText: 'report.pdf',
            token: {
              id: 'file:source-report',
              kind: 'file',
              label: 'report.pdf',
              payload: {
                type: 'document',
                ext: '.pdf',
                name: 'report.pdf',
                path: '/Users/example/private/report.pdf'
              }
            }
          }
        ]
      })
    )

    expect(getComposerClipboardPasteOverride(fragment, {})).toEqual({
      content: [{ type: 'text', text: 'report.pdf' }],
      files: []
    })
  })

  it('delegates text longer than the long-text threshold to the file handler', () => {
    expect(getComposerPlainTextPasteOverride('a'.repeat(1501), {})).toBeNull()
  })
})
