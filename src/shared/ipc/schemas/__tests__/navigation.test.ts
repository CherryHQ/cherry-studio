import { describe, expect, it } from 'vitest'

import { navigationRequestSchemas } from '../navigation'

const focusOrOpen = navigationRequestSchemas['navigation.focus_or_open_conversation'].input
const target = { conversationType: 'agent' as const, conversationId: 'session-1' }
const attachment = { name: 'shot.png', origin_name: 'shot.png', ext: '.png', size: 3, type: 'image' as const }

describe('conversation draft hand-off', () => {
  it('keeps the tokens and both kinds of attachments of an unsent draft', () => {
    const draft = {
      text: '<blockquote>x</blockquote>\nWhy?',
      tokens: [
        {
          id: 'quote:1',
          kind: 'quote',
          label: 'Quote',
          promptText: '<blockquote>x</blockquote>',
          index: 0,
          textOffset: 0
        }
      ],
      files: [
        { ...attachment, fileTokenSourceId: 'pasted', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
        { ...attachment, fileTokenSourceId: 'picked', path: '/Users/me/shot.png' }
      ],
      knowledgeBaseIds: ['kb-1']
    }

    expect(focusOrOpen.parse({ target, title: 'Research', draft }).draft).toEqual(draft)
  })

  it('rejects an attachment path that is not absolute', () => {
    const draft = {
      text: '',
      tokens: [],
      files: [{ ...attachment, fileTokenSourceId: 'f', path: 'shot.png' }],
      knowledgeBaseIds: []
    }

    expect(focusOrOpen.safeParse({ target, title: 'Research', draft }).success).toBe(false)
  })
})
