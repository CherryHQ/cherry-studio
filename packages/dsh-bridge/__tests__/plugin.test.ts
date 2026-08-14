import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../src/plugin'
import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV, createBridgeFrameDecoder, encodeBridgeMessage } from '../src/protocol'

const originalSocket = process.env[BRIDGE_SOCKET_ENV]
const originalToken = process.env[BRIDGE_TOKEN_ENV]

afterEach(() => {
  if (originalSocket === undefined) delete process.env[BRIDGE_SOCKET_ENV]
  else process.env[BRIDGE_SOCKET_ENV] = originalSocket
  if (originalToken === undefined) delete process.env[BRIDGE_TOKEN_ENV]
  else process.env[BRIDGE_TOKEN_ENV] = originalToken
})

describe('cherry bridge plugin', () => {
  it('rejects a resumed session whose persisted cwd differs from the requested workspace', async () => {
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\cherry-dsh-plugin-${randomUUID()}`
        : path.join(os.tmpdir(), `cdp-${randomUUID().slice(0, 8)}.sock`)
    const frames: Record<string, unknown>[] = []
    let peer: net.Socket | undefined
    const server = net.createServer((socket) => {
      peer = socket
      socket.on(
        'data',
        createBridgeFrameDecoder((message) => frames.push(message as Record<string, unknown>))
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })

    const dispose = vi.fn().mockResolvedValue(undefined)
    const resume = vi.fn().mockResolvedValue({
      agent: { session: { header: { cwd: '/old-workspace' } } },
      dispose
    })
    const ctx = {
      agents: { resume, create: vi.fn(), get: vi.fn() },
      tools: { register: vi.fn(), guard: vi.fn() },
      tokenMeter: { measure: vi.fn() },
      effect: vi.fn(),
      on: vi.fn(),
      get: vi.fn()
    } as unknown as Context
    process.env[BRIDGE_SOCKET_ENV] = socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    try {
      apply(ctx)
      await expect.poll(() => frames[0]).toMatchObject({ type: 'ready', token: 'one-time-token' })
      expect(process.env[BRIDGE_TOKEN_ENV]).toBeUndefined()
      peer?.write(
        encodeBridgeMessage({
          type: 'open',
          id: 'open-1',
          sessionId: 'session-1',
          provider: 'deepseek',
          model: 'deepseek-chat',
          cwd: '/new-workspace',
          resume: true,
          policy: {
            permissionMode: 'default',
            disabledTools: [],
            allowedRoots: ['/new-workspace'],
            readTools: [],
            editTools: [],
            autoApprovedTools: [],
            approvalRequiredTools: []
          },
          tools: []
        })
      )

      await expect.poll(() => frames[1]).toMatchObject({ type: 'result', id: 'open-1', ok: false })
      expect(String(frames[1].error)).toContain('does not match')
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      peer?.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (process.platform !== 'win32') await rm(socketPath, { force: true })
    }
  })
})
