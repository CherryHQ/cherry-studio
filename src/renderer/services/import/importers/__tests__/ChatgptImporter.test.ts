import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatgptImporter } from '../ChatgptImporter'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

const conversation = (parts: unknown[]) => ({
  title: 'ChatGPT chat',
  create_time: 1,
  update_time: 2,
  current_node: 'message-1',
  mapping: {
    'message-1': {
      id: 'message-1',
      parent: undefined,
      children: [],
      message: {
        id: 'message-1',
        author: { role: 'assistant' },
        content: { content_type: 'multimodal_text', parts },
        create_time: 1
      }
    }
  }
})

describe('ChatgptImporter', () => {
  let importer: ChatgptImporter

  beforeEach(() => {
    importer = new ChatgptImporter()
  })

  it('converts ChatGPT private-use markers into readable text and links', async () => {
    const text = [
      'About \uE200entity\uE202["company","OpenAI","AI research company"]\uE201.',
      'Visit \uE200url\uE202OpenAI\uE202https://openai.com\uE201.',
      'See \uE200url\uE202the search result\uE202turn0search0\uE201.',
      'Citation\uE200cite\uE202turn0search0\uE201.',
      'File\uE200filecite\uE202turn0file0\uE201.',
      'UI\uE200genui\uE202{"type":"example"}\uE201.',
      'Images\uE200image_group\uE202{"layout":"grid"}\uE201.'
    ].join(' ')

    const result = await importer.parse(JSON.stringify([conversation([text])]))
    const parts = result.conversations[0].messages[0].parts

    expect(parts).toEqual([
      {
        type: 'text',
        text: 'About OpenAI. Visit [OpenAI](https://openai.com). See the search result. Citation. File. UI. Images.'
      }
    ])
  })

  it('imports only text from multimodal content', async () => {
    const result = await importer.parse(
      JSON.stringify([
        conversation([{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://example' }, 'Text'])
      ])
    )

    expect(result.conversations[0].messages[0].parts).toEqual([{ type: 'text', text: 'Text' }])
  })

  it('preserves the complete mapping tree while current_node selects the active branch', async () => {
    const message = (role: 'user' | 'assistant', text: string) => ({
      author: { role },
      content: { content_type: 'text', parts: [text] }
    })
    const result = await importer.parse(
      JSON.stringify([
        {
          title: 'Branched chat',
          create_time: 1,
          current_node: 'assistant-2b',
          mapping: {
            root: { children: ['user-1'] },
            'user-1': { parent: 'root', children: ['assistant-1'], message: message('user', 'question') },
            'assistant-1': {
              parent: 'user-1',
              children: ['user-2a', 'user-2b'],
              message: message('assistant', 'answer')
            },
            'user-2a': {
              parent: 'assistant-1',
              children: ['assistant-2a'],
              message: message('user', 'first follow-up')
            },
            'assistant-2a': {
              parent: 'user-2a',
              children: [],
              message: message('assistant', 'first reply')
            },
            'user-2b': {
              parent: 'assistant-1',
              children: ['assistant-2b'],
              message: message('user', 'edited follow-up')
            },
            'assistant-2b': {
              parent: 'user-2b',
              children: [],
              message: message('assistant', 'edited reply')
            }
          }
        }
      ])
    )

    const importedConversation = result.conversations[0]
    expect(importedConversation.activeSourceId).toBe('assistant-2b')
    expect(importedConversation.messages.map(({ sourceId, parentSourceId }) => ({ sourceId, parentSourceId }))).toEqual(
      [
        { sourceId: 'user-1', parentSourceId: undefined },
        { sourceId: 'assistant-1', parentSourceId: 'user-1' },
        { sourceId: 'user-2a', parentSourceId: 'assistant-1' },
        { sourceId: 'assistant-2a', parentSourceId: 'user-2a' },
        { sourceId: 'user-2b', parentSourceId: 'assistant-1' },
        { sourceId: 'assistant-2b', parentSourceId: 'user-2b' }
      ]
    )
  })
})
