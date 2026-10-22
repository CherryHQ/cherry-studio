import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { CherryUIMessage } from '@shared/data/types/message'

import { AcpConnection } from '../AcpConnection'

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
    const connection = new AcpConnection('session', 'agent', {
      protocol: 'acp',
      enabled: true,
      executableOverride: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/localAgent.mjs', import.meta.url)), 'acp', 'message-ids'],
      env: {}
    })
    const chunks: UIMessageChunk[] = []
    const drained = (async () => {
      for await (const event of connection.events) if (event.type === 'chunk') chunks.push(event.chunk)
    })()
    try {
      await connection.start(cwd)
      for (let turn = 0; turn < 2; turn++) {
        const start = chunks.length
        const user = agentSessionMessageService.saveMessage({
          sessionId: 'session',
          message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'hello' }] } }
        })
        await connection.send({ message: user })
        await vi.waitFor(() => expect(chunks.at(-1)?.type).toBe('finish'))
        let message: CherryUIMessage | undefined
        const stream = new ReadableStream<UIMessageChunk>({
          start(controller) {
            for (const chunk of chunks.slice(start)) controller.enqueue(chunk)
            controller.close()
          }
        })
        for await (const snapshot of readUIMessageStream<CherryUIMessage>({ stream })) message = snapshot
        const parts = message!.parts
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
