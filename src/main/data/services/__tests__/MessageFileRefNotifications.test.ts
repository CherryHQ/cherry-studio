import '@data/services/TopicService'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { messageService } from '@data/services/MessageService'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { FileEntryIdSchema } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notify }))

const fileId = FileEntryIdSchema.parse('019606a0-0000-7000-8000-000000000001')
const secondFileId = FileEntryIdSchema.parse('019606a0-0000-7000-8000-000000000002')
const messageId = '019606a0-0000-7000-8000-000000000003'
const filePart = (id = fileId): CherryMessagePart => ({
  type: 'file',
  mediaType: 'text/plain',
  filename: 'attachment.txt',
  url: 'file:///attachment.txt',
  providerMetadata: { cherry: { fileEntryId: id } }
})
const writers = [
  ['chat PATCH', (parts: CherryMessagePart[]) => messageService.update(messageId, { data: { parts } })],
  [
    'agent PATCH',
    (parts: CherryMessagePart[]) =>
      agentSessionMessageService.updateSessionMessage('session', messageId, { data: { parts } })
  ],
  [
    'agent replace parts',
    (parts: CherryMessagePart[]) => agentSessionMessageService.replaceMessageParts('session', messageId, parts)
  ],
  [
    'agent runtime save',
    (parts: CherryMessagePart[]) =>
      agentSessionMessageService.saveMessage({
        sessionId: 'session',
        message: { id: messageId, role: 'user', data: { parts } }
      })
  ],
  [
    'agent bulk save',
    (parts: CherryMessagePart[]) =>
      agentSessionMessageService.saveMessages({
        sessionId: 'session',
        messages: [{ id: messageId, role: 'user', data: { parts } }]
      })
  ]
] as const

describe('message file-reference read-model notifications', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    notify.mockReset()
    dbh.db
      .insert(fileEntryTable)
      .values(
        [fileId, secondFileId].map((id) => ({
          id,
          origin: 'internal' as const,
          name: 'attachment',
          ext: 'txt',
          size: 1,
          cleanupPolicy: 'manual' as const
        }))
      )
      .run()
    dbh.db.insert(topicTable).values({ id: 'topic', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic', [{ id: messageId, topicId: 'topic', role: 'user', status: 'success', data: { parts: [] } }])
      )
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'workspace', path: '/workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', name: 'session', workspaceId: 'workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({ id: messageId, sessionId: 'session', role: 'user', status: 'success', data: { parts: [] } })
      .run()
  })
  afterEach(() => vi.restoreAllMocks())

  it.each(writers)(
    '%s publishes committed file changes for add, replace and last-reference removal',
    (_name, write) => {
      const events: DataApiDataChangeEffect[][] = []
      notify.mockImplementation((effects: DataApiDataChangeEffect[]) => {
        expect(dbh.sqlite.inTransaction).toBe(false)
        if (effects.some((effect) => effect.endpoint === '/files/entries/ref-counts')) events.push(effects)
      })
      write([filePart()])
      expect(fileRefService.countByEntryIds([fileId]).get(fileId)).toBe(1)
      expect(fileEntryService.listCursor({ usage: 'conversation' }).items.map((entry) => entry.id)).toEqual([fileId])
      expect(events.at(-1)).toEqual(
        expect.arrayContaining([
          { endpoint: '/files/entries', kind: 'membership', entityIds: [fileId] },
          { endpoint: '/files/entries/ref-counts', kind: 'projection', entityIds: [fileId] }
        ])
      )
      events.length = 0
      write([filePart(secondFileId)])
      expect(fileRefService.countByEntryIds([fileId]).get(fileId)).toBeUndefined()
      expect(events.at(-1)).toEqual(
        expect.arrayContaining([
          { endpoint: '/files/entries/ref-counts', kind: 'projection', entityIds: [fileId, secondFileId] }
        ])
      )
      events.length = 0
      write([{ type: 'text', text: 'attachment removed' }])
      expect(fileEntryService.listCursor({ usage: 'conversation' }).items).toEqual([])
      expect(fileEntryService.listCursor({ usage: 'unreferenced' }).total).toBe(2)
      expect(events.at(-1)).toEqual(
        expect.arrayContaining([
          { endpoint: '/files/entries/ref-counts', kind: 'projection', entityIds: [secondFileId] }
        ])
      )
    }
  )

  it.each([
    [
      'chat',
      () => messageService.update(messageId, { data: { parts: [filePart()] } }),
      () => messageService.delete(messageId)
    ],
    [
      'agent',
      () => agentSessionMessageService.updateSessionMessage('session', messageId, { data: { parts: [filePart()] } }),
      () => agentSessionMessageService.deleteSessionMessage('session', messageId)
    ]
  ] as const)(
    '%s deletion invalidates the surviving file after its reference cascades away',
    (_name, write, remove) => {
      write()
      notify.mockClear()
      remove()
      expect(fileRefService.countByEntryIds([fileId]).get(fileId)).toBeUndefined()
      expect(fileEntryService.getById(fileId)).toBeDefined()
      expect(notify.mock.calls.flatMap(([batch]) => batch as DataApiDataChangeEffect[])).toEqual(
        expect.arrayContaining([
          { endpoint: '/files/entries', kind: 'membership', entityIds: [fileId] },
          { endpoint: '/files/entries/ref-counts', kind: 'projection', entityIds: [fileId] }
        ])
      )
    }
  )

  it('returns deferred file effects to a composite Agent transaction without publishing inside it', () => {
    const effects: DataApiDataChangeEffect[] = []
    expect(() =>
      application.get('DbService').withWriteTx((tx) => {
        agentSessionMessageService.saveMessagesTx(
          tx,
          { sessionId: 'session', messages: [{ id: messageId, role: 'user', data: { parts: [filePart()] } }] },
          undefined,
          effects
        )
        expect(effects).toEqual(
          expect.arrayContaining([{ endpoint: '/files/entries/ref-counts', kind: 'projection', entityIds: [fileId] }])
        )
        expect(notify.mock.calls).toEqual([])
        throw new Error('abort composite')
      })
    ).toThrow('abort composite')
    expect(fileRefService.countByEntryIds([fileId]).get(fileId)).toBeUndefined()
    expect(notify.mock.calls).toEqual([])
  })

  it.each(writers)('%s does not invalidate file views for text-only edits', (_name, write) => {
    write([filePart()])
    notify.mockClear()
    write([filePart(), { type: 'text', text: 'new text' }])
    const effects = notify.mock.calls.flatMap(([batch]) => batch as DataApiDataChangeEffect[])
    expect(effects.filter((effect) => effect.endpoint.startsWith('/files/'))).toEqual([])
    expect(fileRefService.countByEntryIds([fileId]).get(fileId)).toBe(1)
  })

  it.each(writers)('%s rolls back reference changes without publishing file invalidations', (_name, write) => {
    write([filePart()])
    notify.mockClear()
    const dbService = application.get('DbService')
    const original = dbService.withWriteTx.bind(dbService)
    vi.spyOn(dbService, 'withWriteTx').mockImplementationOnce((fn) =>
      original((tx) => {
        fn(tx)
        throw new Error('abort transaction')
      })
    )
    expect(() => write([])).toThrow('abort transaction')
    expect(fileRefService.countByEntryIds([fileId]).get(fileId)).toBe(1)
    expect(fileEntryService.listCursor({ usage: 'conversation' }).total).toBe(1)
    expect(notify.mock.calls).toEqual([])
  })
})
