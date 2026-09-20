import { describe, expect, it } from 'vitest'

import type { Message } from '@shared/data/types/message'

import {
  buildCherryTopicFile,
  CHERRY_TOPIC_FILE_KIND,
  CHERRY_TOPIC_FILE_VERSION,
  parseCherryTopicFile,
  toImportConversation,
  validateCherryTopicFileContent
} from '../cherryTopicFormat'

function makeMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  const { id, role, ...rest } = overrides
  return {
    id,
    topicId: 'topic-1',
    parentId: null,
    role,
    data: { parts: [{ type: 'text', text: id }] },
    searchableText: id,
    status: 'success',
    siblingsGroupId: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest
  }
}

const snapshot = (name: string) => ({
  id: 'assistant-1',
  name,
  emoji: '🤖',
  model: { id: 'model-1', name: 'Model 1', provider: 'provider-1' }
})

function branchedInput() {
  return {
    topic: { name: 'My Topic', isNameManuallyEdited: true },
    assistant: { name: 'Ast', emoji: '🤖' },
    messages: [
      makeMessage({ id: 'u1', role: 'user', parentId: 'root-1', createdAt: '2026-01-01T00:00:01.000Z' }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        parentId: 'u1',
        messageSnapshot: snapshot('Ast'),
        data: { parts: [{ type: 'text', text: 'a1' }], turnOptions: { fastMode: true } },
        createdAt: '2026-01-01T00:00:02.000Z'
      }),
      makeMessage({ id: 'u2', role: 'user', parentId: 'root-1', createdAt: '2026-01-01T00:00:03.000Z' }),
      makeMessage({
        id: 'a2a',
        role: 'assistant',
        parentId: 'u2',
        siblingsGroupId: 7,
        messageSnapshot: snapshot('Ast'),
        createdAt: '2026-01-01T00:00:04.000Z'
      }),
      makeMessage({
        id: 'a2b',
        role: 'assistant',
        parentId: 'u2',
        siblingsGroupId: 7,
        status: 'paused',
        messageSnapshot: snapshot('Ast'),
        createdAt: '2026-01-01T00:00:05.000Z'
      })
    ],
    activeNodeId: 'a2b',
    rootId: 'root-1',
    exportedAt: '2026-02-01T00:00:00.000Z'
  }
}

describe('cherryTopicFormat', () => {
  describe('validate', () => {
    it('accepts a file built by the exporter', () => {
      const file = buildCherryTopicFile(branchedInput())
      expect(validateCherryTopicFileContent(JSON.stringify(file))).toBe(true)
    })

    it('rejects invalid JSON and non-topic payloads', () => {
      expect(validateCherryTopicFileContent('not json {')).toBe(false)
      expect(validateCherryTopicFileContent(JSON.stringify({ title: 'x', mapping: {} }))).toBe(false)
    })

    it('rejects a foreign kind and an unsupported version', () => {
      const file = buildCherryTopicFile(branchedInput())
      expect(validateCherryTopicFileContent(JSON.stringify({ ...file, kind: 'other.format' }))).toBe(false)
      expect(validateCherryTopicFileContent(JSON.stringify({ ...file, version: 999 }))).toBe(false)
    })

    it('rejects dangling parents, unknown active nodes and duplicate ids', () => {
      const file = buildCherryTopicFile(branchedInput())
      const dangling = {
        ...file,
        messages: [...file.messages, { sourceId: 'orphan', role: 'user', parts: [], parentSourceId: 'missing' }]
      }
      expect(validateCherryTopicFileContent(JSON.stringify(dangling))).toBe(false)
      expect(validateCherryTopicFileContent(JSON.stringify({ ...file, activeSourceId: 'missing' }))).toBe(false)
      const duplicated = { ...file, messages: [...file.messages, file.messages[0]] }
      expect(validateCherryTopicFileContent(JSON.stringify(duplicated))).toBe(false)
    })
  })

  describe('build', () => {
    it('preserves branches, snapshots, sibling groups, status and the active node', () => {
      const file = buildCherryTopicFile(branchedInput())

      expect(file.kind).toBe(CHERRY_TOPIC_FILE_KIND)
      expect(file.version).toBe(CHERRY_TOPIC_FILE_VERSION)
      expect(file.topic).toEqual({ name: 'My Topic', isNameManuallyEdited: true })
      expect(file.assistant).toEqual({ name: 'Ast', emoji: '🤖' })
      expect(file.activeSourceId).toBe('a2b')

      const byId = new Map(file.messages.map((message) => [message.sourceId, message]))
      expect(file.messages.map((message) => message.sourceId)).toEqual(['u1', 'a1', 'u2', 'a2a', 'a2b'])
      expect(byId.get('u1')?.parentSourceId).toBeUndefined()
      expect(byId.get('a1')?.parentSourceId).toBe('u1')
      expect(byId.get('a2a')?.parentSourceId).toBe('u2')
      expect(byId.get('a2a')?.siblingsGroupId).toBe(7)
      expect(byId.get('a2b')?.siblingsGroupId).toBe(7)
      expect(byId.get('a2b')?.status).toBe('paused')
      expect(byId.get('a1')?.messageSnapshot).toEqual(snapshot('Ast'))
      expect(byId.get('a1')?.turnOptions).toEqual({ fastMode: true })
      expect(byId.get('u1')?.messageSnapshot).toBeUndefined()
    })

    it('drops the virtual root and resolves first turns to the root', () => {
      const file = buildCherryTopicFile({
        ...branchedInput(),
        messages: [
          makeMessage({ id: 'root-1', role: 'root', parentId: null }),
          makeMessage({ id: 'u1', role: 'user', parentId: 'root-1' })
        ],
        activeNodeId: 'u1'
      })

      expect(file.messages.map((message) => message.sourceId)).toEqual(['u1'])
      expect(file.messages[0]?.parentSourceId).toBeUndefined()
      expect(file.activeSourceId).toBe('u1')
    })

    it('builds a valid empty file without an active node', () => {
      const file = buildCherryTopicFile({
        topic: { name: '' },
        messages: [],
        activeNodeId: null,
        rootId: 'root-1',
        exportedAt: '2026-02-01T00:00:00.000Z'
      })

      expect(file.messages).toEqual([])
      expect(file.activeSourceId).toBeUndefined()
      expect(validateCherryTopicFileContent(JSON.stringify(file))).toBe(true)
    })
  })

  describe('parse and convert', () => {
    it('parses a valid file and maps it onto the import contract', () => {
      const file = buildCherryTopicFile(branchedInput())
      const parsed = parseCherryTopicFile(JSON.stringify(file))
      const conversation = toImportConversation(parsed, 'Untitled Topic')

      expect(conversation.name).toBe('My Topic')
      expect(conversation.isNameManuallyEdited).toBe(true)
      expect(conversation.activeSourceId).toBe('a2b')
      expect(conversation.messages).toHaveLength(5)
      expect(conversation.messages.find((message) => message.sourceId === 'a2b')).toMatchObject({
        parentSourceId: 'u2',
        role: 'assistant',
        status: 'paused',
        siblingsGroupId: 7
      })
    })

    it('falls back to the untitled name for a blank topic name', () => {
      const file = buildCherryTopicFile({ ...branchedInput(), topic: { name: '   ' } })
      expect(toImportConversation(parseCherryTopicFile(JSON.stringify(file)), 'Untitled Topic').name).toBe(
        'Untitled Topic'
      )
    })

    it('throws on invalid input instead of returning a partial file', () => {
      expect(() => parseCherryTopicFile('not json {')).toThrow()
      expect(() => parseCherryTopicFile(JSON.stringify({ kind: CHERRY_TOPIC_FILE_KIND }))).toThrow()
    })
  })
})
