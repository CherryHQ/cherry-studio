import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { forkPiSession } from '@main/ai/runtime/pi/piFork'
import { resolveResumeTokenSessionFile } from '@main/ai/runtime/pi/piSessionFile'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'

import { AgentSessionForkOperations } from '../AgentSessionForkOperations'

// Catch mixed-context checkpoints on a second edit and accidental mutation of the shared prefix.
describe('Pi branch publication with native files', () => {
  const dbh = setupTestDatabase()
  let directory: string
  const previous = runtimeDriverRegistry.getAgentSessionDriver('pi')
  afterEach(async () => {
    runtimeDriverRegistry.clearForTest()
    if (previous) runtimeDriverRegistry.register(previous)
    vi.restoreAllMocks()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('retains both native histories, reopens each branch, and forks the shared prefix again', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'pi-product-branches-'))
    const sessions = path.join(directory, 'sessions')
    await mkdir(sessions)
    const originalPath = application.getPath.bind(application)
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      if (key === 'feature.agents.pi.sessions') return sessions
      if (key === 'feature.agents.forks') return path.join(directory, 'forks', filename ?? '')
      return originalPath(key, filename)
    })
    dbh.db.insert(agentTable).values({ id: 'agent', type: 'pi', name: 'Pi', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'work', type: 'user', name: 'Work', path: directory, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'product', agentId: 'agent', workspaceId: 'work', name: 'Tree', orderKey: 'a0' })
      .run()
    runtimeDriverRegistry.register({
      type: 'pi',
      capabilities: ['agent-session'],
      fork: forkPiSession,
      validateSession() {},
      async listAvailableTools() {
        return []
      },
      async connect() {
        throw new Error('Browsing and fork must not run a model')
      }
    })
    const source = SessionManager.create(directory, sessions)
    function input(text: string, manager: SessionManager) {
      manager.appendMessage({ role: 'user', content: text, timestamp: Date.now() })
      return messages.saveMessage({
        sessionId: 'product',
        message: {
          role: 'user',
          status: 'success',
          data: { parts: [{ type: 'text', text }] }
        }
      })
    }
    function answer(text: string, manager: SessionManager) {
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fixture',
        stopReason: 'stop',
        timestamp: Date.now(),
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        }
      })
      return messages.saveMessage({
        sessionId: 'product',
        runtimeResumeToken: manager.getSessionId(),
        runtimeAnchor: {
          checkpoint: { runtime: 'pi', runtimeSessionId: manager.getSessionId(), leafId: manager.getLeafId()! }
        },
        message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text }] } }
      })
    }
    input('Shared input', source)
    const shared = answer('Shared answer', source)
    const old = input('Old question', source)
    answer('Old answer', source)
    const originalFile = await readFile(source.getSessionFile()!, 'utf8')
    const originalRow = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, shared.id))
      .get()
    async function edit(messageId: string) {
      const snapshot = messages.readEditSnapshotTx(dbh.db, 'product', messageId)
      return new AgentSessionForkOperations().edit(
        'product',
        { messageId, version: snapshot.version },
        async () => {},
        (tx, nativeId) => {
          const [row] = messages.saveMessagesTx(tx, {
            sessionId: 'product',
            messages: [
              { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Edited question' }] } }
            ]
          })
          messages.setEditRuntimeTx(tx, 'product', row.id, nativeId)
          return { row, nativeId }
        }
      )
    }
    const first = await edit(old.id)
    const child = SessionManager.open(resolveResumeTokenSessionFile(first.nativeId, sessions)!, sessions, directory)
    expect(JSON.stringify(child.buildSessionContext().messages)).toContain('Shared answer')
    expect(JSON.stringify(child.buildSessionContext().messages)).not.toContain('Old question')
    child.appendMessage({ role: 'user', content: 'Edited question', timestamp: Date.now() })
    const childAnswer = answer('Edited answer', child)
    messages.selectBranch('product', old.id)
    expect(messages.getLastRuntimeResumeToken('product')).toBe(source.getSessionId())
    expect(messages.listSessionMessages('product').items[0].data.parts).toEqual([{ type: 'text', text: 'Old answer' }])
    messages.selectBranch('product', first.row.id)
    expect(messages.getLastRuntimeResumeToken('product')).toBe(first.nativeId)
    expect(messages.listSessionMessages('product').items[0].id).toBe(childAnswer.id)
    const second = await edit(first.row.id)
    expect(second.nativeId).not.toBe(first.nativeId)
    expect(await readFile(source.getSessionFile()!, 'utf8')).toBe(originalFile)
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, shared.id)).get()
    ).toEqual(originalRow)
    const reopened = SessionManager.open(resolveResumeTokenSessionFile(second.nativeId, sessions)!, sessions, directory)
    expect(JSON.stringify(reopened.buildSessionContext().messages)).toContain('Shared answer')
    expect(JSON.stringify(reopened.buildSessionContext().messages)).not.toContain('Edited answer')
  })
})
