import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key)
  }
}))

import { CherryTopicImporter } from '../CherryTopicImporter'

const snapshot = {
  id: 'assistant-1',
  name: 'Ast',
  model: { id: 'model-1', name: 'Model 1', provider: 'provider-1' }
}

const topicFile = (overrides = {}) =>
  JSON.stringify({
    kind: 'cherry-studio.topic',
    version: 1,
    exportedAt: '2026-02-01T00:00:00.000Z',
    topic: { name: 'My Topic', isNameManuallyEdited: true },
    assistant: { name: 'Ast' },
    messages: [
      { sourceId: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }], status: 'success', siblingsGroupId: 0 },
      {
        sourceId: 'a1',
        parentSourceId: 'u1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello' }],
        status: 'success',
        siblingsGroupId: 0,
        messageSnapshot: snapshot
      }
    ],
    activeSourceId: 'a1',
    ...overrides
  })

describe('CherryTopicImporter', () => {
  let importer: CherryTopicImporter

  beforeEach(() => {
    importer = new CherryTopicImporter()
  })

  it('identifies itself under the lookup key used by the import service', () => {
    expect(importer.name).toBe('Cherry')
    expect(importer.name.toLowerCase()).toBe('cherry')
    expect(importer.emoji).toBeTruthy()
  })

  it('accepts a native topic file and rejects foreign formats', () => {
    expect(importer.validate(topicFile())).toBe(true)
    expect(importer.validate(JSON.stringify({ title: 'x', create_time: 1, mapping: {} }))).toBe(false)
    expect(importer.validate(JSON.stringify([{ uuid: 'x', created_at: 'now', chat_messages: [] }]))).toBe(false)
    expect(importer.validate('not json {')).toBe(false)
  })

  it('rejects files with an unsupported version or unresolvable tree', () => {
    expect(importer.validate(topicFile({ version: 2 }))).toBe(false)
    expect(importer.validate(topicFile({ activeSourceId: 'missing' }))).toBe(false)
  })

  it('parses one conversation preserving snapshots and the active node', async () => {
    const result = await importer.parse(topicFile())

    expect(result.conversations).toHaveLength(1)
    const [conversation] = result.conversations
    expect(conversation?.name).toBe('My Topic')
    expect(conversation?.isNameManuallyEdited).toBe(true)
    expect(conversation?.activeSourceId).toBe('a1')
    expect(conversation?.messages.find((message) => message.sourceId === 'a1')).toMatchObject({
      parentSourceId: 'u1',
      messageSnapshot: snapshot
    })
  })

  it('falls back to the untitled name and throws on invalid input', async () => {
    const blank = await importer.parse(topicFile({ topic: { name: '' } }))
    expect(blank.conversations[0]?.name).toBe('Untitled Topic')
    await expect(importer.parse('not json {')).rejects.toThrow()
  })
})
