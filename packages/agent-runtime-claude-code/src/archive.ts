import { Worker } from 'node:worker_threads'

import type { SessionMessage, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'

import { isUuid } from './identity'

export interface NativeArchive {
  messages: SessionMessage[]
  children: { agentId: string; messages: SessionMessage[] }[]
  entries: { subpath?: string; entries: SessionStoreEntry[] }[]
}

export function compactRestorePoint(archive: NativeArchive, boundary: { sessionId: string; messageUuid: string }) {
  const entries = archive.entries.filter((batch) => batch.subpath === undefined).flatMap((batch) => batch.entries)
  const matches = entries.flatMap((entry, index) => (entry.uuid === boundary.messageUuid ? [index] : []))
  if (matches.length !== 1) return undefined
  const index = matches[0]
  const entry = entries[index]
  const summary = entries[index + 1]
  if (
    entry.type !== 'system' ||
    entry.subtype !== 'compact_boundary' ||
    entry.sessionId !== boundary.sessionId ||
    entry.isSidechain ||
    !summary ||
    summary.type !== 'user' ||
    summary.isCompactSummary !== true ||
    summary.sessionId !== boundary.sessionId ||
    summary.isSidechain ||
    summary.parentUuid !== entry.uuid ||
    typeof summary.uuid !== 'string' ||
    !isUuid(summary.uuid) ||
    entries.filter((candidate) => candidate.uuid === summary.uuid).length !== 1
  )
    return undefined
  const following = entries[index + 2]
  if (
    following &&
    (following.type !== 'user' ||
      following.isCompactSummary ||
      following.parentUuid !== summary.uuid ||
      following.sessionId !== boundary.sessionId)
  )
    return undefined
  if (
    entries
      .slice(index + 1)
      .some((candidate) => candidate.type === 'system' && candidate.subtype === 'compact_boundary')
  )
    return undefined
  return { sessionId: boundary.sessionId, messageUuid: summary.uuid }
}

export function readArchive(configDir: string, cwd: string, sessionId: string): Promise<NativeArchive | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./archiveWorker.mjs', import.meta.url), {
      workerData: { sessionId, cwd },
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
    })
    let received = false
    worker.once('message', (value: NativeArchive | null) => {
      received = true
      resolve(value)
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (!received) reject(new Error(`Claude archive worker exited without an archive (${code})`))
    })
  })
}
