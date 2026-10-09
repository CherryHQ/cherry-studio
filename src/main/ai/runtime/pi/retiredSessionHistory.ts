import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import {
  commitRetiredAgentSessionMigration,
  getRetiredAgentSessionMigration,
  listRetiredAgentSessionMigrations,
  readRetiredAgentSessionHistory
} from '@data/services/retiredAgentRuntimeMigration'
import { loggerService } from '@logger'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import type { RuntimeForkAnchor } from '@main/ai/runtime/fork'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'

import { loadPiSdk } from './piSdk'

const logger = loggerService.withContext('retiredSessionHistory')
const pending = new Map<string, Promise<void>>()

export async function migrateRetiredSessionHistories(): Promise<void> {
  const db = application.get('DbService').getDb()
  for (const migration of listRetiredAgentSessionMigrations(db)) {
    try {
      await ensureRetiredSessionHistory(migration.sessionId)
    } catch (error) {
      logger.error('Retired session history migration remains pending', { sessionId: migration.sessionId, error })
    }
  }
}

/** A pending migration must never become a fresh Pi conversation, including on retry or fork. */
export function ensureRetiredSessionHistory(sessionId: string): Promise<void> {
  if (!getRetiredAgentSessionMigration(application.get('DbService').getDb(), sessionId)) return Promise.resolve()
  const existing = pending.get(sessionId)
  if (existing) return existing
  const migrating = importHistory(sessionId).finally(() => pending.delete(sessionId))
  pending.set(sessionId, migrating)
  return migrating
}

async function importHistory(sessionId: string): Promise<void> {
  const db = application.get('DbService').getDb()
  const migration = getRetiredAgentSessionMigration(db, sessionId)
  if (!migration) return
  const history = readRetiredAgentSessionHistory(db, sessionId)
  if (!history) {
    application
      .get('DbService')
      .withWriteTx((tx) => commitRetiredAgentSessionMigration(tx, migration, new Map(), history))
    return
  }
  const sdk = await loadPiSdk()
  const manager = sdk.SessionManager.inMemory(history.workspacePath, { id: migration.resumeToken })
  const anchors = new Map<string, RuntimeForkAnchor>()
  const excludedMessageIds: string[] = []
  for (const row of history.messages) {
    if (
      row.status === 'pending' ||
      row.status === 'streaming' ||
      (row.deliveryStatus && row.deliveryStatus !== 'consumed')
    ) {
      excludedMessageIds.push(row.id)
      continue
    }
    const content = buildAgentUserContent({
      ...row,
      role: row.role as AgentSessionMessageEntity['role'],
      status: row.status as AgentSessionMessageEntity['status'],
      delivery:
        row.delivery && row.deliveryStatus
          ? {
              ...row.delivery,
              status: row.deliveryStatus,
              inReplyTo: row.deliveryInReplyTo,
              turnRef: row.deliveryTurnRef
            }
          : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString()
    })
    const tools = (row.data.parts ?? []).flatMap((part) => {
      if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) return []
      return [JSON.stringify(part)]
    })
    const text = [content, ...tools.map((tool) => `Historical tool record (already executed):\n${tool}`)]
      .filter(Boolean)
      .join('\n\n')
    if (text && row.role === 'user') {
      manager.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: row.createdAt })
    } else if (text && row.role === 'assistant') {
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text }],
        timestamp: row.createdAt,
        api: 'openai-completions',
        provider: 'cherry-history',
        model: 'imported-history',
        stopReason: 'stop',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        }
      })
    } else if (text) {
      manager.appendCustomMessageEntry('cherry-history', text, false)
    }
    const leafId = manager.getLeafId()
    if (leafId && row.role === 'assistant') {
      anchors.set(row.id, {
        checkpoint: { runtime: 'pi', runtimeSessionId: migration.resumeToken, leafId },
        excludedMessageIds: [...excludedMessageIds]
      })
    }
  }
  const sessions = application.getPath('feature.agents.pi.sessions')
  await mkdir(sessions, { recursive: true })
  const file = path.join(sessions, `1970-01-01T00-00-00-000Z_${migration.resumeToken}.jsonl`)
  const temporary = `${file}.tmp`
  try {
    await writeFile(
      temporary,
      [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      { mode: 0o600 }
    )
    const reopened = sdk.SessionManager.open(temporary, sessions, history.workspacePath)
    if (
      reopened.getSessionId() !== migration.resumeToken ||
      reopened.getEntries().length !== manager.getEntries().length
    ) {
      throw new Error('Retired session history validation failed')
    }
    await rename(temporary, file)
    application
      .get('DbService')
      .withWriteTx((tx) => commitRetiredAgentSessionMigration(tx, migration, anchors, history))
  } finally {
    await rm(temporary, { force: true })
  }
}
