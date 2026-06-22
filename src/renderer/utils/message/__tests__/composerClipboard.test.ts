import { describe, expect, it, vi } from 'vitest'

import {
  COMPOSER_CLIPBOARD_FRAGMENT_MIME,
  createComposerAttachmentFromComposerClipboardToken,
  createComposerClipboardFragment,
  createComposerRichClipboardContentFromDraft,
  createComposerRichClipboardContentFromPartGroups,
  createComposerRichClipboardContentFromParts,
  readComposerClipboardFragment,
  readComposerClipboardFragmentFromSessionCache,
  writeComposerRichClipboardContent
} from '../composerClipboard'

function mockRichClipboardWriteEnvironment(
  options: { supportsCustomFormats?: boolean; failCustomWrite?: boolean } = {}
) {
  const write = vi.fn(async () => {})
  if (options.failCustomWrite) write.mockRejectedValueOnce(new Error('write denied'))

  Object.defineProperty(window, 'ClipboardItem', {
    configurable: true,
    value: class {
      static supports = () => options.supportsCustomFormats ?? true
      constructor(_items: Record<string, Blob>) {
        void _items
      }
    }
  })
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { write, writeText: vi.fn(async () => {}) }
  })
  return { write }
}

function createSessionCacheTestContent() {
  const fragment = createComposerClipboardFragment([
    {
      type: 'token',
      token: { id: 'skill:pdf', kind: 'skill', label: 'PDF', promptText: 'Use PDF' },
      fallbackText: '/pdf/'
    }
  ])
  return {
    fragment,
    content: {
      plainText: 'line one\nline two',
      html: '<div>rich copy</div>',
      customFormats: { [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: fragment }
    }
  }
}

describe('composer clipboard', () => {
  it('keeps the file path out of the private fragment while preserving a session restore handle', () => {
    const token = {
      id: 'file:source-image',
      kind: 'file' as const,
      label: 'default-topic.png',
      promptText: 'default-topic.png',
      payload: {
        id: 'file-entry-image',
        fileTokenSourceId: 'source-image',
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
          id: 'file:source-image',
          kind: 'file',
          label: 'default-topic.png',
          promptText: 'default-topic.png',
          payload: {
            type: 'image',
            ext: '.png',
            name: 'default-topic.png',
            origin_name: 'default-topic.png',
            size: 2048,
            handle: expect.any(String)
          }
        }
      }
    ])
    expect(fragmentText).not.toContain('/Users/example/private')
    expect(fragmentText).not.toContain('providerMetadata')

    const segment = fragment?.segments[0]
    expect(segment?.type).toBe('token')
    if (segment?.type === 'token') {
      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).toEqual(
        expect.objectContaining({
          fileTokenSourceId: 'source-image',
          path: '/Users/example/private/default-topic.png',
          type: 'image'
        })
      )
    }
  })

  it('stops resolving file restoration handles after the handle TTL expires', () => {
    vi.useFakeTimers()
    try {
      const token = {
        id: 'file:source-expiring',
        kind: 'file' as const,
        label: 'report.pdf',
        payload: {
          fileTokenSourceId: 'source-expiring',
          name: 'report.pdf',
          path: '/Users/example/private/report.pdf'
        }
      }
      const fragment = readComposerClipboardFragment(
        createComposerClipboardFragment([{ type: 'token', token, fallbackText: token.label }])
      )
      const segment = fragment?.segments[0]
      expect(segment?.type).toBe('token')
      if (segment?.type !== 'token') return

      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).not.toBeNull()

      vi.advanceTimersByTime(30 * 60 * 1000 + 1)

      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reuse incoming file handles when writing private fragments', () => {
    const token = {
      id: 'file:source-image',
      kind: 'file' as const,
      label: 'default-topic.png',
      payload: {
        type: 'image',
        ext: '.png',
        name: 'default-topic.png',
        origin_name: 'default-topic.png',
        handle: 'forged-handle'
      }
    }

    const fragment = readComposerClipboardFragment(
      createComposerClipboardFragment([{ type: 'token', token, fallbackText: token.label }])
    )
    const segment = fragment?.segments[0]

    expect(segment?.type).toBe('token')
    if (segment?.type === 'token') {
      expect(segment.token.payload).not.toHaveProperty('handle')
      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).toBeNull()
    }
  })

  it.each([
    ['missing', undefined],
    ['mismatched', 'other-source']
  ])('does not register a file restore handle when the payload file token source id is %s', (_, fileTokenSourceId) => {
    const token = {
      id: 'file:source-image',
      kind: 'file' as const,
      label: 'default-topic.png',
      payload: {
        id: 'file-entry-image',
        ...(fileTokenSourceId && { fileTokenSourceId }),
        type: 'image',
        ext: '.png',
        name: 'default-topic.png',
        origin_name: 'default-topic.png',
        path: '/Users/example/private/default-topic.png'
      }
    }

    const fragmentText = createComposerClipboardFragment([{ type: 'token', token, fallbackText: token.label }])
    const fragment = readComposerClipboardFragment(fragmentText)
    const segment = fragment?.segments[0]

    expect(fragmentText).not.toContain('/Users/example/private/default-topic.png')
    expect(segment?.type).toBe('token')
    if (segment?.type === 'token') {
      expect(segment.token.payload).not.toHaveProperty('handle')
      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).toBeNull()
    }
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

  it('downgrades file tokens with file URL ids to visible text without leaking the id', () => {
    const token = {
      id: 'file:file:///Users/example/private/default-topic.png',
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
    expect(fragmentText).not.toContain('file:file:///Users/example/private/default-topic.png')
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

  it('downgrades forged private file fragments with file URL ids to visible fallback text', () => {
    const fragment = readComposerClipboardFragment(
      JSON.stringify({
        version: 1,
        segments: [
          {
            type: 'token',
            fallbackText: 'default-topic.png',
            token: {
              id: 'file:file:///Users/example/private/default-topic.png',
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

  it('strips forged path payloads from private file fragments read from the clipboard', () => {
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

    expect(fragment?.segments).toEqual([
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
            name: 'report.pdf'
          }
        }
      }
    ])
    const segment = fragment?.segments[0]
    expect(segment?.type).toBe('token')
    if (segment?.type === 'token') {
      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).toBeNull()
    }
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

  it('keeps file paths private and registers a handle when a matching source file part can restore the attachment', () => {
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
                  id: 'file:source-report',
                  kind: 'file',
                  label: 'report.pdf',
                  index: 0,
                  textOffset: 0,
                  payload: {
                    fileTokenSourceId: 'source-report',
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
        url: 'file:///Users/example/private/report.pdf',
        providerMetadata: {
          cherry: {
            fileTokenSourceId: 'source-report'
          }
        }
      }
    ] as any)

    const fragmentText = content?.customFormats?.[COMPOSER_CLIPBOARD_FRAGMENT_MIME] ?? ''

    expect(content?.plainText).toBe('report.pdf open')
    expect(content?.html).not.toContain('/Users/example/private')
    expect(fragmentText).not.toContain('/Users/example/private/report.pdf')
    expect(readComposerClipboardFragment(fragmentText)?.segments[0]).toMatchObject({
      type: 'token',
      token: {
        id: 'file:source-report',
        kind: 'file',
        label: 'report.pdf',
        payload: {
          handle: expect.any(String)
        }
      }
    })
    const segment = readComposerClipboardFragment(fragmentText)?.segments[0]
    expect(segment?.type).toBe('token')
    if (segment?.type === 'token') {
      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).toEqual(
        expect.objectContaining({
          fileTokenSourceId: 'source-report',
          path: '/Users/example/private/report.pdf',
          type: 'document'
        })
      )
    }
  })

  it('restores Windows file URLs without adding a POSIX leading slash', () => {
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
                  id: 'file:source-report-win',
                  kind: 'file',
                  label: 'report.pdf',
                  index: 0,
                  textOffset: 0,
                  payload: {
                    fileTokenSourceId: 'source-report-win',
                    type: 'document',
                    ext: '.pdf',
                    name: 'report.pdf',
                    origin_name: 'report.pdf'
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
        url: 'file:///C:/Users/example/private/report.pdf',
        providerMetadata: {
          cherry: {
            fileTokenSourceId: 'source-report-win'
          }
        }
      }
    ] as any)

    const fragmentText = content?.customFormats?.[COMPOSER_CLIPBOARD_FRAGMENT_MIME] ?? ''
    const segment = readComposerClipboardFragment(fragmentText)?.segments[0]

    expect(segment?.type).toBe('token')
    if (segment?.type === 'token') {
      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).toEqual(
        expect.objectContaining({
          fileTokenSourceId: 'source-report-win',
          path: 'C:/Users/example/private/report.pdf'
        })
      )
    }
  })

  it('does not restore message file tokens by filename when source ids do not match', () => {
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
                  id: 'file:source-token',
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
        url: 'file:///Users/example/private/report.pdf',
        providerMetadata: {
          cherry: {
            fileTokenSourceId: 'source-part'
          }
        }
      }
    ] as any)

    const fragmentText = content?.customFormats?.[COMPOSER_CLIPBOARD_FRAGMENT_MIME] ?? ''
    const segment = readComposerClipboardFragment(fragmentText)?.segments[0]

    expect(content?.plainText).toBe('report.pdf open')
    expect(fragmentText).not.toContain('/Users/example/private/report.pdf')
    expect(segment).toMatchObject({
      type: 'token',
      token: {
        id: 'file:source-token',
        kind: 'file',
        label: 'report.pdf',
        payload: {
          type: 'document',
          ext: '.pdf',
          name: 'report.pdf',
          origin_name: 'report.pdf',
          size: 4096
        }
      }
    })
    if (segment?.type === 'token') {
      expect(createComposerAttachmentFromComposerClipboardToken(segment.token)).toBeNull()
    }
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
          id: 'file:source-report',
          kind: 'file',
          label: 'report.pdf',
          index: 3,
          textOffset: 'Use PDF Ask docs ${city} '.length,
          payload: {
            id: 'file-1',
            fileTokenSourceId: 'source-report',
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
    expect(fragmentText).not.toContain('/Users/example/private/report.pdf')
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
          id: 'file:source-report',
          kind: 'file',
          label: 'report.pdf',
          payload: {
            type: 'document',
            ext: '.pdf',
            name: 'report.pdf',
            origin_name: 'report.pdf',
            size: 4096,
            handle: expect.any(String)
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

  it('caches the last rich write and restores it only for matching pasted text', async () => {
    const { fragment, content } = createSessionCacheTestContent()
    mockRichClipboardWriteEnvironment()

    await writeComposerRichClipboardContent(content)

    expect(readComposerClipboardFragmentFromSessionCache('line one\nline two')).toEqual(
      readComposerClipboardFragment(fragment)
    )
    expect(readComposerClipboardFragmentFromSessionCache('line one\r\nline two')).toEqual(
      readComposerClipboardFragment(fragment)
    )
    expect(readComposerClipboardFragmentFromSessionCache('other text')).toBeNull()
    expect(readComposerClipboardFragmentFromSessionCache('')).toBeNull()
  })

  it('clears the session cache when the private format is not supported', async () => {
    const { content } = createSessionCacheTestContent()
    mockRichClipboardWriteEnvironment()
    await writeComposerRichClipboardContent(content)

    mockRichClipboardWriteEnvironment({ supportsCustomFormats: false })
    await writeComposerRichClipboardContent(content)

    expect(readComposerClipboardFragmentFromSessionCache('line one\nline two')).toBeNull()
  })

  it('clears the session cache when writing the private format fails', async () => {
    const { content } = createSessionCacheTestContent()
    mockRichClipboardWriteEnvironment()
    await writeComposerRichClipboardContent(content)

    const { write } = mockRichClipboardWriteEnvironment({ failCustomWrite: true })
    await writeComposerRichClipboardContent(content)

    expect(write).toHaveBeenCalledTimes(2)
    expect(readComposerClipboardFragmentFromSessionCache('line one\nline two')).toBeNull()
  })
})
