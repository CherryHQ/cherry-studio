import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import {
  completeImportedHistoryTx,
  getImportedHistoryState,
  readImportedHistory
} from '@data/services/importedSessionHistory'
import type { RuntimeForkAnchor } from '@main/ai/runtime/fork'

import { appendHistoricalMessage } from './historicalMessage'
import { loadPiSdk } from './piSdk'

const pending = new Map<string, Promise<void>>()

export function ensureImportedSessionHistory(sessionId: string): Promise<void> {
  if (!getImportedHistoryState(sessionId)) return Promise.resolve()
  const existing = pending.get(sessionId)
  if (existing) return existing
  const work = initialize(sessionId).finally(() => pending.delete(sessionId))
  pending.set(sessionId, work)
  return work
}

async function initialize(sessionId: string): Promise<void> {
  const state = getImportedHistoryState(sessionId)
  if (!state) return
  if (
    state.status === 'ready' &&
    agentSessionMessageService.getLastRuntimeResumeToken(sessionId) !== state.nativeSessionId
  )
    return
  const history = readImportedHistory(sessionId)
  const sessions = application.getPath('feature.agents.pi.sessions')
  const file = path.join(sessions, '1970-01-01T00-00-00-000Z_' + state.nativeSessionId + '.jsonl')
  const sdk = await loadPiSdk()
  try {
    await stat(file)
    const existing = sdk.SessionManager.open(file, sessions, history.workspace.path)
    if (existing.getSessionId() !== state.nativeSessionId || !existing.getEntries().length)
      throw new Error('history_corrupt')
    if (state.status === 'ready') return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (history.messages.length !== state.messageCount || history.messages.some((row) => !row.provenance))
    throw new Error('history_unrecoverable')
  const manager = sdk.SessionManager.inMemory(history.workspace.path, { id: state.nativeSessionId })
  const anchors = new Map<string, RuntimeForkAnchor>()
  for (const row of history.messages) {
    const text = (row.data.parts ?? [])
      .flatMap((part) => {
        if (part.type === 'text') return [part.text]
        if (part.type === 'reasoning') return ['[Historical reasoning]\n' + part.text]
        return []
      })
      .join('\n\n')
    appendHistoricalMessage(manager, row, text)
    const leafId = manager.getLeafId()
    if (leafId && row.role === 'assistant')
      anchors.set(row.id, {
        checkpoint: { runtime: 'pi', runtimeSessionId: state.nativeSessionId, leafId },
        excludedMessageIds: []
      })
  }
  await mkdir(sessions, { recursive: true })
  const temporary = file + '.tmp'
  try {
    await writeFile(
      temporary,
      [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      { mode: 0o600 }
    )
    const verified = sdk.SessionManager.open(temporary, sessions, history.workspace.path)
    if (
      verified.getSessionId() !== state.nativeSessionId ||
      verified.getEntries().length !== manager.getEntries().length
    )
      throw new Error('history_corrupt')
    readImportedHistory(sessionId)
    await rename(temporary, file)
    application.get('DbService').withWriteTx((tx) => {
      agentSessionMessageService.setImportedAnchorsTx(tx, sessionId, anchors)
      completeImportedHistoryTx(tx, sessionId, state)
    })
  } finally {
    await rm(temporary, { force: true })
  }
}
