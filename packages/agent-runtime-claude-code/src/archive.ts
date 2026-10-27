import { Worker } from 'node:worker_threads'

import type { SessionMessage, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'

export interface NativeArchive {
  messages: SessionMessage[]
  children: { agentId: string; messages: SessionMessage[] }[]
  entries: { subpath?: string; entries: SessionStoreEntry[] }[]
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
