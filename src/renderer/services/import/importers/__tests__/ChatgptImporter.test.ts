import { MessageBlockType } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatgptImporter } from '../ChatgptImporter'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

vi.mock('@renderer/utils/uuid', () => {
  let counter = 0
  return { uuid: () => `uuid-${++counter}` }
})

const ASSISTANT_ID = 'assistant-1'

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

    const result = await importer.parse(JSON.stringify([conversation([text])]), ASSISTANT_ID)
    const block = result.blocks.find((item) => item.type === MessageBlockType.MAIN_TEXT)

    expect(block?.content).toBe(
      'About OpenAI. Visit [OpenAI](https://openai.com). See the search result. Citation. File. UI. Images.'
    )
  })

  it('imports only text from multimodal content', async () => {
    const result = await importer.parse(
      JSON.stringify([
        conversation([{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://example' }, 'Text'])
      ]),
      ASSISTANT_ID
    )

    expect(result.blocks[0].content).toBe('Text')
  })
})
