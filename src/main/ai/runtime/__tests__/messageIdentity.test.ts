import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { applyRuntimePartEdit, partEdits, type RuntimeMessage } from '@cherrystudio/agent-runtime'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentProviderService } from '@data/services/AgentProviderService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { CherryMessagePart } from '@shared/data/types/message'

import { AcpConnection } from '../acp/AcpConnection'
import type { AgentRuntimeEvent } from '../types'
import { localLaunch } from './fixtures/localLaunch'

vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: async () => ({ ...process.env }) }))

describe('ACP message identity', () => {
  const dbh = setupTestDatabase()
  afterEach(() => vi.restoreAllMocks())

  it('keeps native message boundaries and IDs through streaming, consecutive turns and persisted history', async () => {
    const cwd = path.dirname(dbh.sqlite.name)
    vi.mocked(application.getPath).mockReturnValue(cwd)
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Test', path: cwd, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', workspaceId: 'workspace', name: 'Test', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'local', name: 'Local', instructions: '', orderKey: 'a0' })
      .run()
    const config = agentProviderService.setBindingTx(dbh.db, 'agent', {
      enabled: true,
      executableOverride: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/localAgent.mjs', import.meta.url)), 'acp', 'message-ids'],
      env: {}
    })
    const launch = localLaunch(config, config.providerId)
    const connection = new AcpConnection('session', 'agent', launch.config, launch.target)
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    try {
      await connection.start(cwd)
      for (let turn = 0; turn < 2; turn++) {
        const start = events.length
        const user = agentSessionMessageService.saveMessage({
          sessionId: 'session',
          message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'hello' }] } }
        })
        await connection.send({ message: user })
        await vi.waitFor(() => expect(events.at(-1)?.type).toBe('turn-complete'))
        const values: RuntimeMessage['parts'] = []
        for (const event of events.slice(start)) {
          if (!('ref' in event)) continue
          for (const edit of partEdits(event)) {
            const part = applyRuntimePartEdit(values[edit.part], edit)
            if (!part) throw new Error('Invalid part update')
            values[edit.part] = part
          }
        }
        const parts = values as CherryMessagePart[]
        expect(parts.map((part) => part.type)).toEqual([
          'reasoning',
          'text',
          'text',
          'text',
          'dynamic-tool',
          'text',
          'data-acp-content',
          'data-acp-content',
          'text',
          'text',
          'text',
          'data-acp-content'
        ])
        const textParts = parts.flatMap((part) => (part.type === 'text' || part.type === 'reasoning' ? [part] : []))
        expect(textParts.map((part) => [part.text, part.providerMetadata?.acp?.messageId, part.state])).toEqual([
          ['Think carefully', 'thought', 'done'],
          ['First message', 'native:id/中文 1', 'done'],
          ['Second message', 'second', 'done'],
          ['Third message', 'third', 'done'],
          ['After tool', 'third', 'done'],
          ['Legacy response', undefined, 'done'],
          ['Tagged again', 'third', 'done'],
          ['Final without ID', undefined, 'done']
        ])
        expect(parts.filter((part) => part.type === 'data-acp-content').map((part) => part.data)).toEqual([
          { content: { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }, reasoning: false, messageId: 'third' },
          {
            content: { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
            reasoning: true,
            messageId: 'thought-image'
          },
          { content: { type: 'resource_link', uri: 'file:///example.txt', name: 'Result' }, reasoning: false }
        ])
        const id = randomUUID()
        agentSessionMessageService.saveMessage({
          sessionId: 'session',
          message: { id, role: 'assistant', status: 'success', data: { parts } }
        })
        const persisted = agentSessionMessageService.getSessionMessage('session', id)
        expect(persisted.id).toBe(id)
        expect(persisted.data.parts).toEqual(parts)
      }
    } finally {
      await connection.close()
      await drained
    }
  })
})
