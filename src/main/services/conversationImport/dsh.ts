import { createHash } from 'node:crypto'
import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import { readDshSession } from './dshMessages'
import {
  IMPORT_LIMITS,
  type HistorySourceAdapter,
  type NormalizedMessage,
  type NormalizedSession,
  type SessionRef
} from './types'

async function* directories(parent: string, signal: AbortSignal) {
  if ((await realpath(parent)) !== parent) throw new Error('source_changed')
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    signal.throwIfAborted()
    if (entry.isDirectory()) yield path.join(parent, entry.name)
  }
}

function sameMessage(a: NormalizedMessage, b: NormalizedMessage) {
  return (
    a.provenance.originalMessageId === b.provenance.originalMessageId &&
    a.role === b.role &&
    a.status === b.status &&
    a.timestamp === b.timestamp &&
    JSON.stringify(a.data.parts) === JSON.stringify(b.data.parts)
  )
}

function covers(history: NormalizedSession, other: NormalizedSession) {
  if (history.workingDirectory !== other.workingDirectory) return false
  let matched = 0
  for (const message of history.messages) {
    const next = other.messages[matched]
    if (next && sameMessage(message, next)) matched++
  }
  return matched === other.messages.length
}

export const dshAdapter: HistorySourceAdapter = {
  source: 'dsh',
  async *discover(root, signal) {
    const byId = new Map<string, SessionRef>()
    let count = 0
    for await (const project of directories(path.join(root, 'sessions'), signal)) {
      for await (const directory of directories(project, signal)) {
        const copies: SessionRef[] = []
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (!entry.isFile() || !/^session(?:\.v\d+)?\.jsonl\.zstd$/.test(entry.name)) continue
          if (++count > 10000) throw new Error('scan_limit')
          const file = path.join(directory, entry.name)
          const session = await readDshSession(file, signal)
          copies.push({
            path: file,
            originalSessionId: session.originalSessionId,
            title: session.title,
            filteredReason: session.filteredReason
          })
        }
        const siblingIds = new Set(copies.map((copy) => copy.originalSessionId).filter(Boolean))
        for (const copy of copies) {
          // A damaged header beside a known version must participate in validation of that session.
          const id = copy.originalSessionId || (siblingIds.size === 1 ? [...siblingIds][0] : undefined)
          const key = id ? 'id:' + id : 'file:' + copy.path
          const prior = byId.get(key)
          if (!prior) byId.set(key, { ...copy, originalSessionId: id, sourcePaths: [copy.path] })
          else {
            prior.sourcePaths!.push(copy.path)
            if (!copy.filteredReason) prior.filteredReason = undefined
          }
        }
      }
    }
    for (const ref of byId.values()) {
      if ((ref.sourcePaths?.length ?? 0) > 1) {
        try {
          const session = await dshAdapter.read(ref, signal)
          ref.filteredReason = session.filteredReason
          ref.title = session.title
        } catch {
          signal.throwIfAborted()
          ref.filteredReason = undefined
        }
      }
      yield ref
    }
  },
  async read(ref, signal) {
    const paths = [...(ref.sourcePaths ?? [ref.path])].sort()
    const fingerprint = createHash('sha256')
    let bytes = 0
    const copies: NormalizedSession[] = []
    const diagnostics: NormalizedSession['diagnostics'] = []
    for (const file of paths) {
      const copy = await readDshSession(file, signal)
      bytes += copy.inputBytes
      if (bytes > IMPORT_LIMITS.session) throw new Error('session_limit')
      fingerprint.update(JSON.stringify([file, copy.sourceFingerprint]))
      diagnostics.push(...copy.diagnostics)
      if (ref.originalSessionId && ref.originalSessionId !== copy.originalSessionId)
        diagnostics.push({ code: 'identity_conflict', path: file, severity: 'error' })
      copies.push(copy)
    }
    const [chosen, ...others] = copies.sort(
      (a, b) => b.messages.length - a.messages.length || Number(b.sourceVersion) - Number(a.sourceVersion)
    )
    if (!chosen) throw new Error('source_changed')
    for (const other of others) {
      if (!covers(chosen, other))
        diagnostics.push({ code: 'identity_conflict', path: other.sourcePaths[0], severity: 'error' })
    }
    return {
      ...chosen,
      diagnostics,
      filteredReason: diagnostics.length ? undefined : chosen.filteredReason,
      sourcePaths: paths,
      sourceFingerprint: fingerprint.digest('hex'),
      inputBytes: bytes
    }
  }
}
