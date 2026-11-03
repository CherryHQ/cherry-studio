import { realpathSync } from 'node:fs'
import { parse } from 'node:path'

import type { SandboxSpec } from '../src/types.js'

export const limits = {
  startupTimeoutMs: 4000,
  lifetimeMs: 5000,
  stopGraceMs: 50,
  stopTimeoutMs: 1000,
  cleanupTimeoutMs: 500,
  ioDrainTimeoutMs: 100,
  ioBufferBytes: 65536,
  outputBytes: 65536
}

export function spec(
  executable = process.platform === 'win32' ? process.execPath : '/usr/bin/true',
  args: string[] = []
): SandboxSpec & { channel: 'none' } {
  return {
    ownerId: 'test',
    environmentId: 'native',
    runtimeProfileId: 'mxc-command-v1',
    command: {
      executable: process.platform === 'darwin' ? realpathSync(executable) : executable,
      args,
      cwd: process.platform === 'win32' ? parse(executable).root : '/',
      env: {}
    },
    filesystem: { read: [], write: [], denyRead: [], denyWrite: [] },
    network: { mode: 'deny' },
    channel: 'none',
    limits: { ...limits }
  }
}

export async function readAll(stream: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
