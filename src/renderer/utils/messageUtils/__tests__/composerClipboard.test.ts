import { describe, expect, it } from 'vitest'

import {
  COMPOSER_CLIPBOARD_FRAGMENT_MIME,
  createComposerClipboardFragment,
  createComposerRichClipboardContentFromDraft,
  createComposerRichClipboardContentFromPartGroups,
  createComposerRichClipboardContentFromParts,
  readComposerClipboardFragment
} from '../composerClipboard'

describe('composer clipboard', () => {
  it('keeps the file path in the private fragment for re-attach while stripping unknown payload fields', () => {
    const token = {
      id: 'file:image',
      kind: 'file' as const,
      label: 'default-topic.png',
      promptText: 'default-topic.png',
      payload: {
        type: 'image',
        ext: '.png',
        name: 'default-topic.png',
        origin_name: 'default-topic.png',
        size: 2048,
        path: '/Users/example/private/default-topic.png',
        providerMetadata: { secret: true }
      }
    }

    const fragmentText = createComposerClipboardFragment([{ type: 'token', token, fallbackText: token.label }])
    const fragment = readComposerClipboardFragment(fragmentText)

    expect(COMPOSER_CLIPBOARD_FRAGMENT_MIME).toBe('web application/x-cherry-composer-fragment+json')
    expect(fragment?.segments).toEqual([
      {
        type: 'token',
        fallbackText: 'default-topic.png',
        token: {
          id: 'file:image',
          kind: 'file',
          label: 'default-topic.png',
          promptText: 'default-topic.png',
          payload: {
            type: 'image',
            ext: '.png',
            name: 'default-topic.png',
            origin_name: 'default-topic.png',
            size: 2048,
            path: '/Users/example/private/default-topic.png'
          }
        }
      }
    ])
    // The path is intentionally retained inside the private fragment (internal re-attach),
    // but unknown/sensitive fields are dropped.
    expect(fragmentText).toContain('/Users/example/private')
    expect(fragmentText).not.toContain('providerMetadata')
  })

  it('downgrades file tokens with path ids to visible text without leaking the id', () => {
    const token = {
      id: 'file:/Users/example/private/default-topic.png',
      kind: 'file' as const,
      label: 'default-topic.png',
      promptText: 'default-topic.png',
      payload: {
        type: 'image',
        ext: '.png',
        name: 'default-topic.png',
        origin_name: 'default-topic.png',
        size: 2048
      }
    }

    const fragmentText = createComposerClipboardFragment([{ type: 'token', token, fallbackText: token.label }])
    const fragment = readComposerClipboardFragment(fragmentText)

    expect(fragment?.segments).toEqual([{ type: 'text', text: 'default-topic.png' }])
    expect(fragmentText).not.toContain('file:/Users/example/private/default-topic.png')
  })

  it('downgrades forged private file fragments with path ids to visible fallback text', () => {
    const fragment = readComposerClipboardFragment(
      JSON.stringify({
        version: 1,
        segments: [
          {
            type: 'token',
            fallbackText: 'default-topic.png',
            token: {
              id: 'file:/Users/example/private/default-topic.png',
              kind: 'file',
              label: 'default-topic.png',
              promptText: 'hidden injected prompt'
            }
          }
        ]
      })
    )

    expect(fragment?.segments).toEqual([{ type: 'text', text: 'default-topic.png' }])
  })

  it('serializes prompt variable tokens without requiring payload data', () => {
    const fragmentText = createComposerClipboardFragment([
      {
        type: 'token',
        token: {
          id: 'prompt-variable:0:name',
          kind: 'promptVariable',
          label: 'name',
          description: '${name}',
          promptText: '${name}',
          payload: { raw: '${name}', variableName: 'name' }
        },
        fallbackText: '${name}'
      }
    ])

    expect(readComposerClipboardFragment(fragmentText)?.segments).toEqual([
      {
        type: 'token',
        fallbackText: '${name}',
        token: {
          id: 'prompt-variable:0:name',
          kind: 'promptVariable',
          label: 'name',
          description: '${name}',
          promptText: '${name}'
        }
      }
    ])
    expect(fragmentText).not.toContain('variableName')
  })

  it('rejects malformed or unsupported private clipboard fragments', () => {
    const unknownKind = JSON.stringify({
      version: 1,
      segments: [
        {
          type: 'token',
          fallbackText: 'Web search',
          token: {
            id: 'command:web-search',
            kind: 'command',
            label: 'Web search'
          }
        }
      ]
    })
    const invalidVersion = JSON.stringify({
      version: 2,
      segments: [{ type: 'text', text: 'hello' }]
    })

    expect(readComposerClipboardFragment('{not-json')).toBeNull()
    expect(readComposerClipboardFragment(invalidVersion)).toBeNull()
    expect(readComposerClipboardFragment(unknownKind)).toBeNull()
    expect(readComposerClipboardFragment('x'.repeat(250_001))).toBeNull()
  })

  it('creates rich clipboard content for composer message tokens without parseable token html', () => {
    const content = createComposerRichClipboardContentFromParts([
      {
        type: 'text',
        text: 'Use the pdf skill. Ask docs',
        providerMetadata: {
          cherry: {
            composer: {
              version: 1,
              tokens: [
                {
                  id: 'skill:pdf',
                  kind: 'skill',
                  label: 'PDF',
                  index: 0,
                  textOffset: 0,
                  promptText: 'Use the pdf skill.'
                },
                {
                  id: 'knowledge:kb-1',
                  kind: 'knowledge',
                  label: 'Docs',
                  index: 1,
                  textOffset: 'Use the pdf skill. Ask '.length
                }
              ]
            }
          }
        }
      }
    ] as any)

    expect(content?.plainText).toBe('/pdf/ Ask #kb-1#docs')
    expect(content?.html).not.toContain('data-composer-token')
    expect(content?.customFormats?.[COMPOSER_CLIPBOARD_FRAGMENT_MIME]).toBeTypeOf('string')
    expect(readComposerClipboardFragment(content!.customFormats![COMPOSER_CLIPBOARD_FRAGMENT_MIME])?.segments).toEqual([
      {
        type: 'token',
        fallbackText: '/pdf/',
        token: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the pdf skill.'
        }
      },
      { type: 'text', text: ' Ask ' },
      {
        type: 'token',
        fallbackText: '#kb-1#',
        token: {
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Docs'
        }
      },
      { type: 'text', text: 'docs' }
    ])
  })

  it('keeps file paths private when a matching file part can restore the attachment', () => {
    const content = createComposerRichClipboardContentFromParts([
      {
        type: 'text',
        text: ' open',
        providerMetadata: {
          cherry: {
            composer: {
              version: 1,
              tokens: [
                {
                  id: 'file:file-1',
                  kind: 'file',
                  label: 'report.pdf',
                  index: 0,
                  textOffset: 0,
                  payload: {
                    type: 'document',
                    ext: '.pdf',
                    name: 'report.pdf',
                    origin_name: 'report.pdf',
                    size: 4096
                  }
                }
              ]
            }
          }
        }
      },
      {
        type: 'file',
        filename: 'report.pdf',
        mediaType: 'application/pdf',
        url: 'file:///Users/example/private/report.pdf'
      }
    ] as any)

    const fragmentText = content?.customFormats?.[COMPOSER_CLIPBOARD_FRAGMENT_MIME] ?? ''

    expect(content?.plainText).toBe('report.pdf open')
    expect(content?.html).not.toContain('/Users/example/private')
    expect(fragmentText).toContain('/Users/example/private/report.pdf')
    expect(readComposerClipboardFragment(fragmentText)?.segments[0]).toMatchObject({
      type: 'token',
      token: {
        id: 'file:file-1',
        kind: 'file',
        label: 'report.pdf',
        payload: {
          path: '/Users/example/private/report.pdf'
        }
      }
    })
  })

  it('creates one private fragment for multiple selected message groups', () => {
    const content = createComposerRichClipboardContentFromPartGroups(
      [
        [
          {
            type: 'text',
            text: 'Use the pdf skill. hello',
            providerMetadata: {
              cherry: {
                composer: {
                  version: 1,
                  tokens: [
                    {
                      id: 'skill:pdf',
                      kind: 'skill',
                      label: 'PDF',
                      index: 0,
                      textOffset: 0,
                      promptText: 'Use the pdf skill.'
                    }
                  ]
                }
              }
            }
          }
        ],
        [{ type: 'text', text: 'plain reply' }]
      ] as any,
      '\n\n---\n\n'
    )

    expect(content?.plainText).toBe('/pdf/ hello\n\n---\n\nplain reply')
    expect(readComposerClipboardFragment(content!.customFormats![COMPOSER_CLIPBOARD_FRAGMENT_MIME])?.segments).toEqual([
      {
        type: 'token',
        fallbackText: '/pdf/',
        token: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the pdf skill.'
        }
      },
      { type: 'text', text: ' hello\n\n---\n\nplain reply' }
    ])
  })

  it('creates rich clipboard content from selected composer draft tokens', () => {
    const content = createComposerRichClipboardContentFromDraft({
      text: 'Use PDF Ask docs ${city}  after',
      tokens: [
        {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          index: 0,
          textOffset: 0,
          promptText: 'Use PDF'
        },
        {
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Docs',
          index: 1,
          textOffset: 'Use PDF Ask '.length
        },
        {
          id: 'prompt-variable:0:city',
          kind: 'promptVariable',
          label: 'city',
          description: '${city}',
          promptText: '${city}',
          index: 2,
          textOffset: 'Use PDF Ask docs '.length
        },
        {
          id: 'file:file-1',
          kind: 'file',
          label: 'report.pdf',
          index: 3,
          textOffset: 'Use PDF Ask docs ${city} '.length,
          payload: {
            type: 'document',
            ext: '.pdf',
            name: 'report.pdf',
            origin_name: 'report.pdf',
            size: 4096,
            path: '/Users/example/private/report.pdf'
          }
        }
      ]
    })

    const fragmentText = content?.customFormats?.[COMPOSER_CLIPBOARD_FRAGMENT_MIME] ?? ''

    expect(content?.plainText).toBe('/pdf/ Ask #kb-1#docs ${city} report.pdf after')
    expect(content?.html).not.toContain('data-composer-token')
    expect(content?.html).not.toContain('/Users/example/private/report.pdf')
    expect(fragmentText).toContain('/Users/example/private/report.pdf')
    expect(readComposerClipboardFragment(fragmentText)?.segments).toEqual([
      {
        type: 'token',
        fallbackText: '/pdf/',
        token: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use PDF'
        }
      },
      { type: 'text', text: ' Ask ' },
      {
        type: 'token',
        fallbackText: '#kb-1#',
        token: {
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Docs'
        }
      },
      { type: 'text', text: 'docs ' },
      {
        type: 'token',
        fallbackText: '${city}',
        token: {
          id: 'prompt-variable:0:city',
          kind: 'promptVariable',
          label: 'city',
          description: '${city}',
          promptText: '${city}'
        }
      },
      { type: 'text', text: ' ' },
      {
        type: 'token',
        fallbackText: 'report.pdf',
        token: {
          id: 'file:file-1',
          kind: 'file',
          label: 'report.pdf',
          payload: {
            type: 'document',
            ext: '.pdf',
            name: 'report.pdf',
            origin_name: 'report.pdf',
            size: 4096,
            path: '/Users/example/private/report.pdf'
          }
        }
      },
      { type: 'text', text: ' after' }
    ])
  })

  it('returns no rich clipboard content for plain drafts and downgrades unsafe selected tokens', () => {
    expect(createComposerRichClipboardContentFromDraft({ text: 'plain text', tokens: [] })).toBeNull()

    const content = createComposerRichClipboardContentFromDraft({
      text: 'Run command ',
      tokens: [
        {
          id: 'command:web-search',
          kind: 'command',
          label: 'Web Search',
          index: 0,
          textOffset: 0,
          promptText: 'Run command'
        },
        {
          id: 'file:/Users/example/private/secret.pdf',
          kind: 'file',
          label: 'secret.pdf',
          index: 1,
          textOffset: 'Run command '.length,
          payload: {
            type: 'document',
            ext: '.pdf',
            name: 'secret.pdf',
            path: '/Users/example/private/secret.pdf'
          }
        }
      ]
    })

    const fragmentText = content?.customFormats?.[COMPOSER_CLIPBOARD_FRAGMENT_MIME] ?? ''

    expect(content?.plainText).toBe('Run command secret.pdf')
    expect(content?.html).not.toContain('/Users/example/private/secret.pdf')
    expect(fragmentText).not.toContain('command:web-search')
    expect(fragmentText).not.toContain('file:/Users/example/private/secret.pdf')
    expect(readComposerClipboardFragment(fragmentText)?.segments).toEqual([
      { type: 'text', text: 'Run command secret.pdf' }
    ])
  })
})
