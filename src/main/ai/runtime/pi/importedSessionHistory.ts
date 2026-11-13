import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { completeImportedHistoryTx, getImportedHistoryState } from '@data/services/importedSessionHistory'
import { readForkPrefix, type RuntimeForkAnchor } from '@main/ai/runtime/fork'

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
  if (state.status === 'ready') {
    const token = agentSessionMessageService.getLastRuntimeResumeToken(sessionId)
    if (!token && state.messageCount > 0) throw new Error('history_unrecoverable')
    if (token !== state.nativeSessionId) return
  }
  const history = agentSessionMessageService.readImportedHistory(sessionId)
  const sessions = application.getPath('feature.agents.pi.sessions')
  const file = path.join(sessions, '1970-01-01T00-00-00-000Z_' + state.nativeSessionId + '.jsonl')
  const sdk = await loadPiSdk()
  const manager = sdk.SessionManager.inMemory(history.workspace.path, { id: state.nativeSessionId })
  const anchors = new Map<string, RuntimeForkAnchor>()
  for (const row of history.messages.filter((message) => message.provenance)) {
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
  try {
    const source = await readForkPrefix(file, (await stat(file)).size)
    const entries = source
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))
    const existing = sdk.SessionManager.inMemory(history.workspace.path, undefined, entries)
    const expected = manager.getEntries()
    const prefix = existing.getEntries().slice(0, expected.length)
    if (
      existing.getSessionId() !== state.nativeSessionId ||
      prefix.length !== expected.length ||
      new Set(prefix.map(({ id }) => id)).size !== prefix.length ||
      expected.some((entry, index) => {
        const actual = prefix[index]
        return (
          actual.parentId !== (index ? prefix[index - 1].id : null) ||
          !isDeepStrictEqual(
            { ...entry, id: actual.id, parentId: actual.parentId, timestamp: actual.timestamp },
            actual
          )
        )
      })
    )
      throw new Error('history_corrupt')
    if (state.status === 'ready') return
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('history_corrupt')
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (history.messages.length !== state.messageCount || history.messages.some((row) => !row.provenance))
    throw new Error('history_unrecoverable')
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
    if (
      JSON.stringify(agentSessionMessageService.readImportedHistory(sessionId).messages) !==
      JSON.stringify(history.messages)
    )
      throw new Error('history_changed')
    await rename(temporary, file)
    application.get('DbService').withWriteTx((tx) => {
      if (
        JSON.stringify(agentSessionMessageService.readImportedHistory(sessionId, tx).messages) !==
        JSON.stringify(history.messages)
      )
        throw new Error('history_changed')
      agentSessionMessageService.setImportedAnchorsTx(tx, sessionId, anchors)
      completeImportedHistoryTx(tx, sessionId, state)
    })
  } finally {
    await rm(temporary, { force: true })
  }
}
