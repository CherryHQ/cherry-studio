import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'

import { node } from '@elysia/node'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'

import { jsonRpcResponseSchema, remoteLimits } from '@cherrystudio/remote-protocol'
import {
  agentMethods,
  type AgentMethod,
  type AgentParams,
  type AgentResult,
  type AgentPart,
  type AgentMessage
} from '@cherrystudio/remote-protocol/agent'
import {
  type ChannelOptions,
  type SecureChannel,
  connectSecureChannel,
  createDeviceIdentity,
  deviceIdentityId,
  RemoteSocketStream
} from '@cherrystudio/remote-transport'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { BaseService } from '@main/core/lifecycle'
import { RemoteConnection } from '@main/services/remoteAccess/RemoteConnection'
import type { CherryMessagePart } from '@shared/data/types/message'

const desktopIdentity = vi.hoisted(() => ({ bytes: undefined as Uint8Array | undefined }))
const service = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('@main/services/remoteAccess/deviceIdentity', () => ({
  loadDesktopIdentity: async () => desktopIdentity.bytes
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const factory = mockApplicationFactory({
    AiStreamManager: { hasLiveStream: () => false, addListener: () => false },
    AgentSessionRuntimeService: { isSessionBusy: () => false }
  } as never)
  const get = factory.application.get.bind(factory.application)
  factory.application.get = ((name: string) =>
    name === 'RemoteAccessService' ? service.current : get(name)) as typeof factory.application.get
  return factory
})

import { RemoteAccessService } from '@main/services/remoteAccess'

import { remoteRoutes } from '../remote'

type Logger = ReturnType<ChannelOptions['logger']['forComponent']>
const silent = (): Logger => Object.assign(() => {}, { error() {}, trace() {}, enabled: false, newScope: silent })
const logger: ChannelOptions['logger'] = { forComponent: silent }

describe('remote ws route', () => {
  let http: Server | undefined
  let port: number

  beforeEach(async () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.api_gateway.enabled': true,
      'feature.api_gateway.host': '0.0.0.0'
    })
    mockMainLoggerService.warn.mockClear()
    BaseService.resetInstances()
    desktopIdentity.bytes = await createDeviceIdentity()
    service.current = new RemoteAccessService()
    const app = new Elysia({ adapter: node() }).use(remoteRoutes)
    type Info = { raw?: { ready?: () => Promise<unknown>; node?: { server?: Server } } }
    const info = await new Promise<Info>((resolve) => app.listen({ port: 0, hostname: '127.0.0.1' }, resolve))
    // The listen callback fires before the socket is bound; `ready()` settles once it is.
    await info.raw?.ready?.()
    http = info.raw?.node?.server
    if (!http) throw new Error('Expected Node HTTP server')
    port = (http.address() as AddressInfo).port
  })

  afterEach(async () => {
    ;(service.current as RemoteAccessService).closeIngress()
    await new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve()))
  })

  it('upgrades a paired device and answers hello through the Noise channel', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/remote/connect`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    const channel = await connectSecureChannel(new RemoteSocketStream(socket, silent(), 'outbound'), {
      identity: await createDeviceIdentity(),
      logger,
      protocolVersions: [1],
      remoteIdentity: deviceIdentityId(desktopIdentity.bytes!),
      signal: AbortSignal.timeout(5000)
    })
    await channel.write({ jsonrpc: '2.0', id: 1, method: 'connection.hello', params: { protocolVersions: [1] } })
    expect(await channel.read(AbortSignal.timeout(5000))).toMatchObject({ id: 1, result: { protocolVersion: 1 } })
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
    await channel.close()
    await closed
    await new Promise<void>((resolve) => http!.close(() => resolve()))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(
      mockMainLoggerService.warn.mock.calls.filter(([message]) => message === 'Remote session ended with an error')
    ).toEqual([])
  })

  it('allows native clients that include an Origin header', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/remote/connect`, { origin: 'http://192.168.1.8' })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.close()
    })
  })

  it('allows 256 requests per second and refuses excess requests without ending the session', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/remote/connect`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    const channel = await connectSecureChannel(new RemoteSocketStream(socket, silent(), 'outbound'), {
      identity: await createDeviceIdentity(),
      logger,
      protocolVersions: [1],
      remoteIdentity: deviceIdentityId(desktopIdentity.bytes!),
      signal: AbortSignal.timeout(5000)
    })
    await channel.write({ jsonrpc: '2.0', id: 0, method: 'connection.hello', params: { protocolVersions: [1] } })
    expect(await channel.read(AbortSignal.timeout(5000))).toMatchObject({ id: 0, result: { protocolVersion: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    const writes = Array.from({ length: 262 }, (_, id) =>
      channel.write({ jsonrpc: '2.0', id: id + 1, method: 'connection.ping', params: { nonce: String(id) } })
    )
    await Promise.all(writes)
    const responses: ReturnType<typeof jsonRpcResponseSchema.parse>[] = []
    for (let id = 0; id < 262; id++)
      responses.push(jsonRpcResponseSchema.parse(await channel.read(AbortSignal.timeout(5000))))
    expect(new Set(responses.map((response) => response.id)).size).toBe(262)
    expect(responses.filter((response) => 'result' in response)).toHaveLength(256)
    const refusals = responses.filter((response) => 'error' in response)
    expect(refusals).toHaveLength(6)
    for (const response of refusals) {
      if (!('error' in response)) throw new Error('Expected a refusal')
      expect(response.error).toMatchObject({ code: 1000, data: { reason: 'RATE_LIMITED' } })
      const retryAfterMs = (response.error.data as { retryAfterMs: number }).retryAfterMs
      expect(Number.isInteger(retryAfterMs)).toBe(true)
      expect(retryAfterMs).toBeGreaterThanOrEqual(1)
    }
    expect(mockMainLoggerService.warn).not.toHaveBeenCalledWith('Remote session ended with an error', expect.anything())
    expect(socket.readyState).toBe(WebSocket.OPEN)

    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await channel.write({ jsonrpc: '2.0', id: 263, method: 'connection.ping', params: { nonce: 'after' } })
    expect(await channel.read(AbortSignal.timeout(5000))).toMatchObject({ id: 263, result: { nonce: 'after' } })
    await channel.close()
  }, 15_000)

  it.each(['invalid-frame', 'handshake-timeout'])(
    'still reports %s as a failure',
    async (failure) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/remote/connect`)
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      const closed = new Promise<number>((resolve) => socket.once('close', resolve))
      if (failure === 'invalid-frame') socket.send(Buffer.from([1, 0xff]))
      expect(await closed).toBe(1008)
      await new Promise<void>((resolve) => http!.close(() => resolve()))
      await new Promise<void>((resolve) => setImmediate(resolve))
      const failures = mockMainLoggerService.warn.mock.calls.filter(
        ([message]) => message === 'Remote session ended with an error'
      )
      expect(failures).toHaveLength(1)
      expect(failures[0][1]).toMatchObject({
        error: expect.stringMatching(failure === 'handshake-timeout' ? /timeout/i : /encoded data/i)
      })
    },
    15_000
  )
  describe('page byte budget', () => {
    const dbh = setupTestDatabase()
    type Probe = {
      label: string
      phase: 'attempted' | 'received' | 'close' | 'cleanup'
      bytes: number
      itemCount: number
      cursor: string | null
      closeCode: number | null
      closeReason: string | null
      pingOk: boolean | null
      method?: string
      inputCursor?: string | null
      requestedLimit?: number
      recoveredIds?: string[]
    }
    const report: Probe[] = []
    let records: Probe[]
    let socket: WebSocket
    let channel: SecureChannel
    let closed: { code: number; reason: string } | undefined
    let cleanup: boolean
    let label: string
    let requestId: number
    let sessionId: string
    let workspaceId: string
    const requests = new Map<string | number | null, { method: string; cursor?: string; limit?: number }>()
    const messageIds = new Map<string, string>()
    const messageId = (name: string): string => {
      if (!messageIds.has(name))
        messageIds.set(name, `00000000-0000-4000-8000-${String(messageIds.size).padStart(12, '0')}`)
      return messageIds.get(name)!
    }

    const record = (value: unknown, phase: Probe['phase']) => {
      const response = jsonRpcResponseSchema.parse(value)
      const page =
        'result' in response ? (response.result as { items?: unknown[]; nextCursor?: string | null }) : undefined
      const request = requests.get(response.id)
      records.push({
        label,
        phase,
        method: request?.method,
        inputCursor: request?.cursor ?? null,
        requestedLimit: request?.limit,
        recoveredIds: page?.items?.map((item) => {
          const dto = item as Record<string, unknown>
          return String(
            dto.partId ?? dto.messageId ?? dto.sessionId ?? dto.interactionId ?? dto.agentId ?? dto.workspaceId
          )
        }),
        bytes: Buffer.byteLength(JSON.stringify(value)),
        itemCount: page?.items?.length ?? 0,
        cursor: page?.nextCursor ?? null,
        closeCode: null,
        closeReason: null,
        pingOk: null
      })
    }
    const raw = async (method: string, params: unknown, id: string | number = ++requestId) => {
      requests.set(id, { method, ...(params as { cursor?: string; limit?: number }) })
      await channel.write({ jsonrpc: '2.0', id, method, params })
      let value: unknown
      try {
        value = await channel.read(AbortSignal.timeout(5000))
      } catch (error) {
        let pingOk = false
        try {
          await channel.write({
            jsonrpc: '2.0',
            id: 'post-failure-ping',
            method: 'connection.ping',
            params: { nonce: 'post-failure' }
          })
          const ping = jsonRpcResponseSchema.parse(await channel.read(AbortSignal.timeout(500)))
          pingOk = 'result' in ping && (ping.result as { nonce?: string }).nonce === 'post-failure'
        } catch {}
        for (const entry of records) entry.pingOk = pingOk
        await new Promise<void>((resolve) => setImmediate(resolve))
        if (closed) expect(closed).toEqual({ code: 1011, reason: 'Remote request failed' })
        const attemptedBytes = Math.max(
          ...records.filter((entry) => entry.phase === 'attempted').map((entry) => entry.bytes)
        )
        expect(attemptedBytes, 'Count-only pages must not attempt an oversized response record').toBeLessThanOrEqual(
          remoteLimits.recordBytes
        )
        expect(
          closed,
          `Response lost; close=${JSON.stringify(closed)}; attempted=${JSON.stringify(records)}`
        ).toBeUndefined()
        throw error
      }
      record(value, 'received')
      expect(
        Buffer.byteLength(JSON.stringify(value)),
        'Count-only pages must not exceed the record ceiling'
      ).toBeLessThanOrEqual(remoteLimits.recordBytes)
      const response = jsonRpcResponseSchema.parse(value)
      expect(response.id, 'Responses must preserve the request identity').toBe(id)
      return response
    }
    const call = async <M extends AgentMethod>(method: M, params: AgentParams<M>): Promise<AgentResult<M>> => {
      const response = await raw(method, params)
      expect('error' in response ? response.error : undefined, `${method} must remain readable`).toBeUndefined()
      if (!('result' in response)) throw new Error('Expected success')
      return agentMethods[method].result.parse(response.result) as AgentResult<M>
    }
    const survive = async () => {
      const ping = await raw('connection.ping', { nonce: 'after-page' })
      expect(ping).toMatchObject({ result: { nonce: 'after-page' } })
      const read = await call('agent.sessions.get', { sessionId })
      expect(read.session.sessionId).toBe(sessionId)
      expect(closed, `Unexpected close: ${JSON.stringify(closed)}`).toBeUndefined()
      expect(socket.readyState, 'An oversized response must not poison subsequent writes').toBe(WebSocket.OPEN)
      expect(records.filter((r) => r.phase === 'attempted').every((r) => r.bytes <= remoteLimits.recordBytes)).toBe(
        true
      )
      for (const entry of records) entry.pingOk = true
    }
    const save = (id: string, parts: CherryMessagePart[]) =>
      agentSessionMessageService.saveMessage({
        sessionId,
        message: { id: messageId(id), role: 'assistant', status: 'success', data: { parts } }
      })
    const toolParts = (count: number): CherryMessagePart[] =>
      Array.from({ length: count }, (_, i) => ({
        type: 'dynamic-tool',
        toolName: 'probe',
        toolCallId: `call-${i}`,
        state: 'output-available',
        input: 'a'.repeat(4094),
        output: 'b'.repeat(4094)
      }))
    const messages = async () => {
      const { session } = await call('agent.sessions.get', { sessionId })
      return call('agent.messages.list', { sessionId, historyRevision: session.historyRevision, limit: 100 })
    }
    const readParts = async (message: Pick<AgentMessage, 'messageId' | 'revision'>) => {
      const items: AgentPart[] = []
      let cursor: string | undefined
      do {
        const page = await call('agent.parts.list', {
          sessionId,
          messageId: message.messageId,
          messageRevision: message.revision,
          cursor,
          limit: 100
        })
        items.push(...page.items)
        cursor = page.nextCursor ?? undefined
        expect(items.length, 'A repeated cursor must not loop forever').toBeLessThanOrEqual(4096)
      } while (cursor !== undefined)
      return items
    }

    beforeEach(async (context) => {
      label = context.task.name
      records = []
      messageIds.clear()
      requests.clear()
      requestId = 0
      closed = undefined
      cleanup = false
      const original = RemoteConnection.prototype.send
      vi.spyOn(RemoteConnection.prototype, 'send').mockImplementation(function (this: RemoteConnection, value) {
        record(value, 'attempted')
        return original.call(this, value)
      })
      dbh.db
        .insert(agentTable)
        .values({ id: 'agent-1', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
        .run()
      workspaceId = dbh.db.transaction((tx) =>
        agentWorkspaceService.findOrCreateByPathTx(tx, '/tmp/remote-page-budget')
      ).id
      sessionId = agentSessionService.create({
        agentId: 'agent-1',
        name: 'Chat',
        workspace: { type: 'user', workspaceId }
      }).id
      await (service.current as RemoteAccessService)._doInit()
      const identity = await createDeviceIdentity()
      const { device } = apiGatewayPairedDeviceService.approveRemote({
        name: 'Probe',
        platform: 'ios',
        peerIdentity: deviceIdentityId(identity),
        capabilities: ['agent']
      })
      socket = new WebSocket(`ws://127.0.0.1:${port}/v1/remote/connect`)
      socket.on('close', (code, reason) => {
        if (!cleanup) {
          closed = { code, reason: reason.toString() }
          for (const entry of records) {
            entry.closeCode = code
            entry.closeReason = reason.toString()
          }
        }
        records.push({
          label,
          phase: cleanup ? 'cleanup' : 'close',
          bytes: 0,
          itemCount: 0,
          cursor: null,
          closeCode: code,
          closeReason: reason.toString(),
          pingOk: null
        })
      })
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      channel = await connectSecureChannel(new RemoteSocketStream(socket, silent(), 'outbound'), {
        identity,
        logger,
        protocolVersions: [1],
        remoteIdentity: deviceIdentityId(desktopIdentity.bytes!),
        signal: AbortSignal.timeout(5000)
      })
      expect(await raw('connection.hello', { protocolVersions: [1] })).toMatchObject({
        result: { protocolVersion: 1, agentMessageSummariesVersion: 1 }
      })
      expect(await raw('agent.agents.list', {})).toMatchObject({ error: { data: { reason: 'UNAUTHENTICATED' } } })
      expect(await raw('agent.messages.list', { sessionId, historyRevision: '0', partsMode: 'paged' })).toMatchObject({
        error: { data: { reason: 'UNAUTHENTICATED' } }
      })
      expect(await raw('connection.authenticate', { deviceId: device.id })).toMatchObject({
        result: { deviceId: device.id }
      })
    })

    afterEach(async () => {
      cleanup = true
      try {
        if (socket?.readyState === WebSocket.OPEN) {
          const ended = new Promise<void>((resolve) => socket.once('close', () => resolve()))
          await channel.close()
          await ended
        }
        await (service.current as RemoteAccessService)._doStop()
      } finally {
        vi.restoreAllMocks()
        if (process.env.REMOTE_PAGE_PROBE_JSON) report.push(...records)
      }
    })
    afterAll(() => {
      if (!process.env.REMOTE_PAGE_PROBE_JSON) return
      const require = createRequire(import.meta.url)
      const sources = [
        'src/main/services/remoteAccess/agentQueries.ts',
        'src/main/services/remoteAccess/agentHandlers.ts',
        'src/main/services/remoteAccess/RemoteConnection.ts',
        'src/main/services/remoteAccess/RemoteAccessService.ts',
        'src/main/services/remoteAccess/agentJournal.ts',
        'src/main/data/services/AgentSessionMessageService.ts',
        'src/main/data/services/AgentSessionService.ts',
        'packages/remote-transport/src/records.ts',
        'packages/remote-transport/src/rpc.ts',
        'src/main/features/apiGateway/routes/__tests__/remote.test.ts'
      ]
      writeFileSync(
        process.env.REMOTE_PAGE_PROBE_JSON,
        JSON.stringify(
          {
            boundary: 'loopback Elysia / Noise / SQLite runtime',
            packages: ['@cherrystudio/remote-protocol', '@cherrystudio/remote-transport'].map((name) => ({
              name,
              path: require.resolve(name)
            })),
            sources: sources.map((path) => ({
              path,
              sha256: createHash('sha256').update(readFileSync(path)).digest('hex')
            })),
            responses: report
          },
          null,
          2
        )
      )
    })

    it.each([6, 25, 41])('traverses %i near-inline parts without losing the connection', async (count) => {
      for (let i = 0; i < 12; i++) save(`small-${i}`, [{ type: 'text', text: 'small' }])
      const parts =
        count === 6
          ? toolParts(3)
          : [...toolParts((count - 1) / 2), { type: 'text' as const, text: 'long'.repeat(10_000) }]
      save('large-message', parts)
      dbh.db
        .update(agentSessionMessageTable)
        .set({ createdAt: 1 })
        .where(eq(agentSessionMessageTable.sessionId, sessionId))
        .run()
      for (let i = 0; i < 12; i++)
        dbh.db
          .update(agentSessionMessageTable)
          .set({ createdAt: 2 })
          .where(eq(agentSessionMessageTable.id, messageId(`small-${i}`)))
          .run()
      const page = await messages()
      expect(page.items.map((item) => item.messageId)).toEqual([
        ...Array.from({ length: 12 }, (_, i) => messageId(`small-${11 - i}`)),
        messageId('large-message')
      ])
      expect(page.nextCursor).toBeNull()
      const message = page.items[12]
      const expected =
        count === 6
          ? Array.from({ length: 3 }, (_, i) => [
              `${messageId('large-message')}:${i}:in`,
              `${messageId('large-message')}:${i}:out`
            ]).flat()
          : [
              ...Array.from({ length: (count - 1) / 2 }, (_, i) => [
                `${messageId('large-message')}:${i}:in`,
                `${messageId('large-message')}:${i}:out`
              ]).flat(),
              `${messageId('large-message')}:${(count - 1) / 2}`
            ]
      expect(message.partIds).toEqual(expected)
      const received = await readParts(message)
      expect(received.map((part) => part.partId)).toEqual(expected)
      for (const part of received) {
        if (part.kind === 'file') continue
        if ('text' in part.content) {
          expect(part.content.text).toBe(JSON.stringify((part.kind === 'tool-input' ? 'a' : 'b').repeat(4094)))
        } else {
          const ref = part.content.ref
          const chunks: Buffer[] = []
          let offset = '0'
          for (;;) {
            const slice = await call('agent.content.read', {
              sessionId,
              contentId: ref.contentId,
              revision: ref.revision,
              offset,
              maxBytes: 24_576
            })
            chunks.push(Buffer.from(slice.dataBase64, 'base64'))
            expect(slice.sha256).toBe(ref.sha256)
            offset = slice.nextOffset
            if (slice.eof) break
          }
          const bytes = Buffer.concat(chunks)
          expect(bytes.toString()).toBe('long'.repeat(10_000))
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sha256)
          expect(bytes.length).toBe(Number(ref.byteLength))
        }
      }
      await survive()
    })

    it.each(['\u0000', '漢'])(
      'traverses JSON-encoded %j text without truncation or raw-byte sizing',
      async (character) => {
        save(
          'encoded',
          Array.from({ length: 25 }, () => ({ type: 'text', text: character.repeat(4096) }))
        )
        const page = await messages()
        const parts = await readParts(page.items[0])
        expect(parts.map((part) => part.partId)).toEqual(
          Array.from({ length: 25 }, (_, i) => `${messageId('encoded')}:${i}`)
        )
        for (const part of parts) expect(part.kind !== 'file' && part.content).toEqual({ text: character.repeat(4096) })
        await survive()
      }
    )

    it('re-queries message keysets across equal timestamps without skips or duplicates', async () => {
      const ids = Array.from({ length: 45 }, (_, i) => `message-${String(i).padStart(3, '0')}`)
      for (const id of ids) save(id, [...toolParts(20), { type: 'text', text: 'tail' }])
      dbh.db
        .update(agentSessionMessageTable)
        .set({ createdAt: 1 })
        .where(eq(agentSessionMessageTable.sessionId, sessionId))
        .run()
      const { session } = await call('agent.sessions.get', { sessionId })
      const recovered: string[] = []
      let cursor: string | undefined
      do {
        const page = await call('agent.messages.list', {
          sessionId,
          historyRevision: session.historyRevision,
          cursor,
          limit: 100
        })
        for (const item of page.items) expect(item.partIds).toHaveLength(41)
        recovered.push(...page.items.map((item) => item.messageId))
        cursor = page.nextCursor ?? undefined
        expect(recovered.length).toBeLessThanOrEqual(ids.length)
      } while (cursor !== undefined)
      expect(recovered).toEqual(ids.map(messageId).toReversed())
      await survive()
    })

    it('refuses a 4096-ID indivisible message with a bounded error and preserves later writes', async () => {
      save(
        'indivisible-message',
        Array.from({ length: 4096 }, () => ({ type: 'text', text: 'small' }))
      )
      const { session } = await call('agent.sessions.get', { sessionId })
      const id = '\u0000'.repeat(256)
      const response = await raw(
        'agent.messages.list',
        { sessionId, historyRevision: session.historyRevision, limit: 1 },
        id
      )
      expect(response).toMatchObject({
        id,
        error: { code: 1000, data: { reason: 'RESOURCE_EXHAUSTED', message: 'Page item exceeds response byte budget' } }
      })
      await survive()
    })

    it.each([1600, 4096].flatMap((parts) => [1, 20, 100].map((limit) => ({ parts, limit }))))(
      'reads every message and all $parts parts in paged mode with message limit $limit',
      async ({ parts, limit }) => {
        save('first', [{ type: 'text', text: 'first' }])
        save('huge', [
          ...Array.from({ length: parts - 2 }, (_, i) => ({ type: 'text' as const, text: `漢\\\u0000${i}` })),
          {
            type: 'dynamic-tool',
            toolName: 'probe',
            toolCallId: 'tool',
            state: 'output-available',
            input: 'input',
            output: 'output'
          }
        ])
        save('last', [{ type: 'text', text: 'last' }])
        const { session } = await call('agent.sessions.get', { sessionId })
        const ids: string[] = []
        let cursor: string | undefined
        do {
          const page = await call('agent.messages.list', {
            sessionId,
            historyRevision: session.historyRevision,
            partsMode: 'paged',
            limit,
            cursor
          })
          for (const message of page.items) {
            expect(message).toMatchObject({ partsMode: 'paged', role: 'assistant', status: 'success' })
            expect(message).not.toHaveProperty('partIds')
            ids.push(message.messageId)
            if (message.messageId !== messageId('huge')) continue
            const recovered = await readParts(message)
            expect(recovered).toEqual([
              ...Array.from({ length: parts - 2 }, (_, i) =>
                expect.objectContaining({
                  partId: `${message.messageId}:${i}`,
                  kind: 'text',
                  content: { text: `漢\\\u0000${i}` }
                })
              ),
              expect.objectContaining({
                partId: `${message.messageId}:${parts - 2}:in`,
                kind: 'tool-input',
                content: { text: '"input"' }
              }),
              expect.objectContaining({
                partId: `${message.messageId}:${parts - 2}:out`,
                kind: 'tool-output',
                content: { text: '"output"' }
              })
            ])
            expect(
              await raw('agent.parts.list', { sessionId, messageId: message.messageId, messageRevision: '0' })
            ).toMatchObject({ error: { data: { reason: 'REVISION_EXPIRED' } } })
            expect(
              await raw('agent.parts.list', {
                sessionId,
                messageId: message.messageId,
                messageRevision: message.revision,
                cursor: 'invalid'
              })
            ).toMatchObject({ error: { data: { reason: 'NOT_FOUND' } } })
          }
          cursor = page.nextCursor ?? undefined
          expect(ids.length).toBeLessThanOrEqual(3)
        } while (cursor !== undefined)
        expect(ids).toEqual(['last', 'huge', 'first'].map(messageId))
        expect(await raw('agent.messages.list', { sessionId, historyRevision: '0', partsMode: 'paged' })).toMatchObject(
          { error: { data: { reason: 'REVISION_EXPIRED' } } }
        )
        await survive()
      }
    )

    it.each([undefined, 1, 100])(
      'preserves small-page counts, values and offset/keyset cursors at limit %s',
      async (limit) => {
        const ids = Array.from({ length: 101 }, (_, i) => `catalog-${String(i).padStart(3, '0')}`)
        dbh.db
          .insert(agentTable)
          .values(ids.map((id) => ({ id, type: 'claude-code', name: id, instructions: '', orderKey: id })))
          .run()
        const all = ['agent-1', ...ids]
        const count = limit ?? 20
        const page = await call('agent.agents.list', { limit })
        expect(page.items.map((item) => item.agentId)).toEqual(all.slice(0, count))
        expect(page.nextCursor).toBe(String(count))
        const next = await call('agent.agents.list', { cursor: page.nextCursor!, limit: 100 })
        expect(next.items.map((item) => item.agentId)).toEqual(all.slice(count, count + 100))
        expect(next.nextCursor).toBe(count === 1 ? '101' : null)
        for (const id of ids) save(id, [{ type: 'text', text: id }])
        dbh.db
          .update(agentSessionMessageTable)
          .set({ createdAt: 1 })
          .where(eq(agentSessionMessageTable.sessionId, sessionId))
          .run()
        const { session } = await call('agent.sessions.get', { sessionId })
        const msg = await call('agent.messages.list', { sessionId, historyRevision: session.historyRevision, limit })
        expect(msg.items.map((item) => item.messageId)).toEqual(ids.map(messageId).toReversed().slice(0, count))
        expect(msg.nextCursor).toBe(`1:${messageId(ids[101 - count])}`)
        dbh.db
          .insert(agentWorkspaceTable)
          .values(ids.map((id) => ({ id, name: id, path: `/tmp/${id}`, orderKey: id })))
          .run()
        const spaces = await call('agent.workspaces.list', { agentId: 'agent-1', limit })
        expect(spaces.items.map((item) => item.workspaceId)).toEqual([workspaceId, ...ids].slice(0, count))
        expect(spaces.nextCursor).toBe(String(count))
        expect(spaces.systemWorkspace).toBe(true)
        dbh.db
          .insert(agentSessionTable)
          .values(ids.map((id) => ({ id, agentId: 'agent-1', workspaceId, name: id, orderKey: id })))
          .run()
        const sessions = await call('agent.sessions.list', { agentId: 'agent-1', workspaceId, limit })
        expect(sessions.items.map((item) => item.sessionId)).toEqual([sessionId, ...ids].slice(0, count))
        expect(sessions.nextCursor).toBe(
          count === 1
            ? `entity:${agentSessionService.getConversationById(sessionId).orderKey}:${sessionId}`
            : `entity:${ids[count - 2]}:${ids[count - 2]}`
        )
        const saved = save(
          'small-parts',
          ids.map((id) => ({ type: 'text', text: id }))
        )
        const savedMessage = (await messages()).items[0]
        expect(savedMessage.messageId).toBe(saved.id)
        const parts = await call('agent.parts.list', {
          sessionId,
          messageId: saved.id,
          messageRevision: savedMessage.revision,
          limit
        })
        expect(parts.items.map((part) => part.partId)).toEqual(
          Array.from({ length: count }, (_, i) => `${saved.id}:${i}`)
        )
        expect(parts.nextCursor).toBe(String(count))
        save(
          'small-approvals',
          ids.map((id) => ({
            type: 'dynamic-tool',
            toolName: 'probe',
            toolCallId: id,
            state: 'approval-requested',
            input: 'small',
            approval: { id }
          }))
        )
        const approvals = await call('agent.interactions.list', { sessionId, limit })
        expect(approvals.items.map((item) => item.interactionId)).toEqual(ids.slice(0, count))
        expect(approvals.nextCursor).toBe(String(count))
        await survive()
      }
    )

    it('budgets agent and workspace catalogs while preserving system creation and ordered traversal', async () => {
      const ids = Array.from({ length: 35 }, (_, i) => `large-${String(i).padStart(3, '0')}`)
      dbh.db
        .insert(agentTable)
        .values(ids.map((id) => ({ id, type: 'claude-code', name: 'a'.repeat(4096), instructions: '', orderKey: id })))
        .run()
      dbh.db
        .insert(agentWorkspaceTable)
        .values(ids.map((id) => ({ id, name: 'w'.repeat(4096), path: `/tmp/${id}`, orderKey: id })))
        .run()
      const agents: string[] = []
      const workspaces: string[] = []
      let cursor: string | undefined
      do {
        const page = await call('agent.agents.list', { cursor, limit: 100 })
        agents.push(...page.items.map((item) => item.agentId))
        cursor = page.nextCursor ?? undefined
        expect(agents.length).toBeLessThanOrEqual(36)
      } while (cursor !== undefined)
      expect(agents).toEqual(['agent-1', ...ids])
      cursor = undefined
      do {
        const page = await call('agent.workspaces.list', { agentId: 'agent-1', cursor, limit: 100 })
        expect(page.systemWorkspace).toBe(true)
        workspaces.push(...page.items.map((item) => item.workspaceId))
        cursor = page.nextCursor ?? undefined
        expect(workspaces.length).toBeLessThanOrEqual(36)
      } while (cursor !== undefined)
      expect(workspaces).toEqual([workspaceId, ...ids])
      await survive()
    })

    it('budgets projected sessions across pin/entity transitions, filters and orphan rows', async () => {
      const ids = Array.from({ length: 105 }, (_, i) => `session-${String(i).padStart(3, '0')}`)
      dbh.db
        .insert(agentSessionTable)
        .values(ids.map((id) => ({ id, agentId: 'agent-1', workspaceId, name: '漢'.repeat(255), orderKey: id })))
        .run()
      dbh.db
        .insert(agentSessionTable)
        .values({ id: 'orphan', agentId: null, workspaceId, name: 'Orphan', orderKey: 'a1' })
        .run()
      dbh.db
        .insert(pinTable)
        .values(ids.slice(0, 60).map((id) => ({ entityType: 'session', entityId: id, orderKey: id })))
        .run()
      const recovered: string[] = []
      let cursor: string | undefined
      do {
        const page = await call('agent.sessions.list', { workspaceId, cursor, limit: 100 })
        recovered.push(...page.items.map((item) => item.sessionId))
        cursor = page.nextCursor ?? undefined
        expect(recovered.length).toBeLessThanOrEqual(106)
      } while (cursor !== undefined)
      expect(recovered).toEqual([...ids.slice(0, 60), sessionId, ...ids.slice(60)])
      const filtered = await call('agent.sessions.list', { agentId: 'agent-1', workspaceId: 'missing', limit: 100 })
      expect(filtered).toEqual({ items: [], nextCursor: null })
      dbh.db.delete(pinTable).run()
      const transition = await call('agent.sessions.list', {
        agentId: 'agent-1',
        workspaceId,
        cursor: 'pin:session-059:session-059',
        limit: 100
      })
      expect(transition).toEqual({ items: [], nextCursor: 'entity:' })
      const next = await call('agent.sessions.list', {
        agentId: 'agent-1',
        workspaceId,
        cursor: transition.nextCursor!,
        limit: 1
      })
      expect(next.items.map((item) => item.sessionId)).toEqual([sessionId])
      expect(next.nextCursor).toMatch(/^entity:/)
      await survive()
    })

    it('budgets persisted interactions after merging without dropping approval identities', async () => {
      const ids = Array.from({ length: 30 }, (_, i) => `approval-${i}`)
      save(
        'approvals',
        ids.map((id) => ({
          type: 'dynamic-tool',
          toolName: 'probe',
          toolCallId: id,
          state: 'approval-requested',
          input: 'a'.repeat(4094),
          approval: { id }
        }))
      )
      const recovered: string[] = []
      let cursor: string | undefined
      do {
        const page = await call('agent.interactions.list', { sessionId, cursor, limit: 100 })
        recovered.push(...page.items.map((item) => item.interactionId))
        cursor = page.nextCursor ?? undefined
        expect(recovered.length).toBeLessThanOrEqual(ids.length)
      } while (cursor !== undefined)
      expect(recovered).toEqual(ids)
      await survive()
    })

    it('retains invalid parameter, offset and stale revision errors without closing', async () => {
      for (const params of [{ limit: 0 }, { limit: 101 }, { cursor: 'a'.repeat(257) }]) {
        expect(await raw('agent.agents.list', params)).toMatchObject({ error: { code: -32602 } })
      }
      for (const cursor of ['-1', 'invalid'])
        expect(await raw('agent.agents.list', { cursor })).toMatchObject({ error: { data: { reason: 'NOT_FOUND' } } })
      save('revision', [{ type: 'text', text: 'hello' }])
      expect(await raw('agent.messages.list', { sessionId, historyRevision: '0' })).toMatchObject({
        error: { data: { reason: 'REVISION_EXPIRED' } }
      })
      expect(
        await raw('agent.parts.list', { sessionId, messageId: messageId('revision'), messageRevision: '0' })
      ).toMatchObject({ error: { data: { reason: 'REVISION_EXPIRED' } } })
      await survive()
    })
  })
})
