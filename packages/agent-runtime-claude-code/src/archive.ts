import { deserialize } from 'node:v8'
import { Worker } from 'node:worker_threads'

import type { SessionMessage, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'

export type NativeArchiveEntry = Pick<SessionStoreEntry, 'type' | 'uuid'> &
  Partial<
    Pick<
      SessionStoreEntry,
      'supersedes' | 'retracted_message_uuids' | 'isAbortedMidStream' | 'isApiErrorMessage' | 'parentAgentId'
    >
  >

export interface NativeArchive {
  messages: SessionMessage[]
  children: { agentId: string; messages: SessionMessage[] }[]
  entries: { subpath?: string; entries: NativeArchiveEntry[] }[]
}

export const ARCHIVE_CHUNK_BYTES = 16 * 1024 * 1024

type ArchiveFrame =
  | { kind: 'entries'; subpath?: string; buffers: ArrayBuffer[] }
  | { kind: 'child'; agentId: string }
  | { kind: 'child-messages'; agentId: string; buffers: ArrayBuffer[] }
  | { kind: 'messages'; buffers: ArrayBuffer[] }
  | { kind: 'done' | 'missing' }

export function readArchive(configDir: string, cwd: string, sessionId: string): Promise<NativeArchive | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./archiveWorker.mjs', import.meta.url), {
      workerData: { sessionId, cwd, chunkBytes: ARCHIVE_CHUNK_BYTES },
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
    })
    const archive: NativeArchive = { messages: [], children: [], entries: [] }
    let received = false
    const fail = (error: unknown) => {
      reject(error)
      void worker.terminate()
    }
    worker.on('message', (frame: ArchiveFrame) => {
      try {
        switch (frame.kind) {
          case 'missing':
          case 'done':
            received = true
            resolve(frame.kind === 'done' ? archive : null)
            return
          case 'child':
            archive.children.push({ agentId: frame.agentId, messages: [] })
            break
          case 'child-messages': {
            const child = archive.children.at(-1)
            if (child?.agentId !== frame.agentId) throw new Error('Claude archive worker sent an unexpected child')
            for (const buffer of frame.buffers) child.messages.push(deserialize(new Uint8Array(buffer)))
            break
          }
          case 'entries': {
            let batch = archive.entries.at(-1)
            if (!batch || batch.subpath !== frame.subpath) {
              batch = { subpath: frame.subpath, entries: [] }
              archive.entries.push(batch)
            }
            for (const buffer of frame.buffers) batch.entries.push(deserialize(new Uint8Array(buffer)))
            break
          }
          case 'messages':
            for (const buffer of frame.buffers) archive.messages.push(deserialize(new Uint8Array(buffer)))
            break
        }
        worker.postMessage('ack')
      } catch (error) {
        fail(error)
      }
    })
    worker.once('messageerror', fail)
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (!received) reject(new Error(`Claude archive worker exited without an archive (${code})`))
    })
  })
}
