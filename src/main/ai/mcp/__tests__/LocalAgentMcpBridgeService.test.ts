import { spawn } from 'node:child_process'
import http from 'node:http'
import { createInterface } from 'node:readline'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentProviderService } from '@data/services/AgentProviderService'
import { BaseService, Emitter } from '@main/core/lifecycle'
import type { AutomationAccess, AutomationOwner } from '@main/services/automation/contracts'

import { buildStdioHttpMcpShimConfig } from '../../runtime/acp/stdioHttpMcpShim'
import { LocalAgentMcpBridgeService } from '../LocalAgentMcpBridgeService'

describe('LocalAgentMcpBridgeService', () => {
  const dbh = setupTestDatabase()
  let bridge: LocalAgentMcpBridgeService
  let terminal: Emitter<never>
  let idle: Emitter<never>
  let browserEnabled: boolean
  let liveMessageId: string | undefined
  let capturedAccess: AutomationAccess | undefined
  let closeOwnerCalls: number

  beforeEach(async () => {
    BaseService.resetInstances()
    browserEnabled = true
    liveMessageId = 'assistant-msg-1'
    capturedAccess = undefined
    closeOwnerCalls = 0
    terminal = new Emitter()
    idle = new Emitter()

    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent-1',
        type: 'local',
        name: 'Claude Local',
        instructions: '',
        orderKey: 'a0'
      })
      .run()
    dbh.db.transaction((tx) => agentProviderService.setBindingTx(tx, 'agent-1', { presetId: 'claude', enabled: true }))
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'ws-1', name: 'Workspace', path: '/test/workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session-1', agentId: 'agent-1', workspaceId: 'ws-1', name: 'Task', orderKey: 'a0' })
      .run()

    const get = application.getContainer().get.bind(application.getContainer())
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'PreferenceService') {
        return { get: (key: string) => (key === 'app.browser.agent_control.enabled' ? browserEnabled : undefined) }
      }
      if (name === 'AgentSessionRuntimeService') {
        return {
          getLiveAssistantMessageId: () => liveMessageId,
          onTurnTerminal: terminal.event,
          onRuntimeIdle: idle.event
        }
      }
      if (name === 'AutomationReplService') {
        return {
          beginRun: (_owner: AutomationOwner, _runId: string, access: () => AutomationAccess) => ({
            execute: async (code: string) => {
              capturedAccess = access()
              return { content: [{ type: 'text', text: `ran:${code}` }] }
            },
            reset: async () => {
              capturedAccess = access()
              return { content: [{ type: 'text', text: 'reset-ok' }] }
            },
            finish: async () => {}
          }),
          close: async () => {
            closeOwnerCalls++
          }
        }
      }
      return get(name as Parameters<typeof get>[0])
    }) as typeof application.get)

    bridge = new LocalAgentMcpBridgeService()
    await bridge._doInit()
  })

  afterEach(async () => {
    await bridge._doStop()
    terminal.dispose()
    idle.dispose()
    vi.restoreAllMocks()
  })

  async function rawHttp(
    urlString: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ): Promise<{ status: number; body: string }> {
    const target = new URL(urlString)
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname + target.search,
          method: options.method ?? 'POST',
          headers: options.headers
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        }
      )
      req.on('error', reject)
      if (options.body) req.write(options.body)
      req.end()
    })
  }

  it('enforces Bearer token, Host, Origin, browser-only exposure, read-only propagation, and lease disposal', async () => {
    let readOnly = false
    let browserAllowed = true
    const lease = await bridge.issueBrowserLease({
      sessionId: 'session-1',
      agentId: 'agent-1',
      isBrowserAllowed: () => browserAllowed,
      isReadOnly: () => readOnly
    })
    const url = new URL(lease.url)

    expect(
      (
        await rawHttp(lease.url, {
          headers: { 'content-type': 'application/json' },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
        })
      ).status
    ).toBe(401)

    expect(
      (
        await rawHttp(lease.url, {
          headers: { authorization: 'Bearer wrong-token', 'content-type': 'application/json' },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
        })
      ).status
    ).toBe(401)

    expect(
      (
        await rawHttp(lease.url, {
          headers: {
            host: `evil.example:${url.port}`,
            authorization: `Bearer ${lease.token}`,
            'content-type': 'application/json'
          },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
        })
      ).status
    ).toBe(403)

    expect(
      (
        await rawHttp(lease.url, {
          headers: {
            origin: 'https://evil.example',
            authorization: `Bearer ${lease.token}`,
            'content-type': 'application/json'
          },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
        })
      ).status
    ).toBe(403)

    const client = new Client({ name: 'test-http', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { ...lease.headers } }
    })
    await client.connect(transport)
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual(['js', 'reset'])
      const jsTool = listed.tools.find((tool) => tool.name === 'js')
      expect(jsTool?.description).toContain('cherry-browser')
      expect(jsTool?.description).not.toContain('computer.getApp')

      const okResult = await client.callTool({ name: 'js', arguments: { code: '1+1' } })
      expect(okResult.isError).not.toBe(true)
      expect(capturedAccess).toEqual({ browser: true, computer: false, browserReadOnly: false })

      readOnly = true
      await client.callTool({ name: 'js', arguments: { code: 'read' } })
      expect(capturedAccess).toEqual({ browser: true, computer: false, browserReadOnly: true })

      browserAllowed = false
      await client.callTool({ name: 'js', arguments: { code: 'denied' } })
      expect(capturedAccess).toEqual({ browser: false, computer: false, browserReadOnly: true })

      liveMessageId = undefined
      const inactiveResult = await client.callTool({ name: 'js', arguments: { code: 'after-turn' } })
      expect(inactiveResult.isError).toBe(true)
    } finally {
      await transport.close().catch(() => {})
    }

    await lease.dispose()
    expect(closeOwnerCalls).toBe(1)

    expect(
      (
        await rawHttp(lease.url, {
          headers: { ...lease.headers, 'content-type': 'application/json' },
          body: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
        })
      ).status
    ).toBe(401)
  })

  it('relays MCP JSON-RPC through stdioHttpMcpShim without exposing tokens in argv', async () => {
    const lease = await bridge.issueBrowserLease({
      sessionId: 'session-1',
      agentId: 'agent-1'
    })
    const shim = buildStdioHttpMcpShimConfig(lease.url, lease.token)
    expect(shim.args.join(' ')).not.toContain(lease.token)
    expect(shim.env).toEqual(
      expect.arrayContaining([
        { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
        { name: 'CHERRY_MCP_URL', value: lease.url },
        { name: 'CHERRY_MCP_TOKEN', value: lease.token }
      ])
    )

    const child = spawn(shim.command, shim.args, {
      env: { ...process.env, ...Object.fromEntries(shim.env.map((item) => [item.name, item.value])) },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const lines = createInterface({ input: child.stdout })
    const received: Array<Record<string, unknown>> = []
    lines.on('line', (line) => {
      received.push(JSON.parse(line) as Record<string, unknown>)
    })

    try {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'shim-test', version: '1.0.0' }
          }
        })}\n`
      )
      await vi.waitFor(() => expect(received.some((msg) => msg.id === 1)).toBe(true))

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
      await vi.waitFor(() => expect(received.some((msg) => msg.id === 2)).toBe(true))

      const toolsResponse = received.find((msg) => msg.id === 2) as { result?: { tools?: Array<{ name: string }> } }
      expect(toolsResponse.result?.tools?.map((t) => t.name)).toEqual(['js', 'reset'])

      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'js', arguments: { code: 'via-shim' } }
        })}\n`
      )
      await vi.waitFor(() => expect(received.some((msg) => msg.id === 3)).toBe(true))
      const callResponse = received.find((msg) => msg.id === 3) as {
        result?: { content?: Array<{ type: string; text: string }> }
      }
      expect(callResponse.result?.content).toEqual([{ type: 'text', text: 'ran:via-shim' }])
    } finally {
      lines.close()
      child.kill()
      await lease.dispose()
    }
  })
})
