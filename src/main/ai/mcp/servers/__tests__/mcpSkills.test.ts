import { InMemoryTransport, type Client } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { setupTestDatabase } from '@test-helpers/db'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { createMcpSkillsFixture } from '@test-helpers/mcpSkills'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { ClientMcpConnection } from '@main/ai/mcp/connections/ClientMcpConnection'
import type { McpConnection } from '@main/ai/mcp/connections/McpConnection'
import { McpCatalogService } from '@main/ai/mcp/McpCatalogService'
import { McpRuntimeService } from '@main/ai/mcp/McpRuntimeService'
import { BaseService } from '@main/core/lifecycle'

import { createSkillsServer } from '../skills'

const transport = vi.hoisted(() => ({ connect: vi.fn<() => Promise<McpConnection>>() }))
vi.mock('@main/ai/mcp/connections/ExternalMcpConnection', () => ({ createExternalMcpConnection: transport.connect }))

const agentId = 'skill-agent'
const sessionId = 'skill-session'
const factsUri = 'skill://reports/references/facts.txt'

describe('remote skills MCP tools', () => {
  const dbh = setupTestDatabase()
  let runtime: McpRuntimeService
  let fixture: ReturnType<typeof createMcpSkillsFixture>
  let serverId: string
  let client: Client

  beforeEach(async () => {
    BaseService.resetInstances()
    fixture = createMcpSkillsFixture()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    serverId = mcpServerService.create({
      name: 'Reports origin',
      type: 'streamableHttp',
      baseUrl: 'http://127.0.0.1:1/mcp',
      isActive: true
    }).id
    dbh.db.insert(agentMcpServerTable).values({ agentId, mcpServerId: serverId }).run()
    runtime = new McpRuntimeService()
    const catalog = new McpCatalogService()
    const container = application.getContainer()
    const get = container.get.bind(container)
    vi.spyOn(container, 'get').mockImplementation((name) => {
      if (name === 'McpRuntimeService') return runtime
      if (name === 'McpCatalogService') return catalog
      if (name === 'AgentSessionRuntimeService') return { getMcpInteractionHost: () => undefined }
      return get(name)
    })
    transport.connect.mockImplementation(async () => {
      const [upstream, peer] = InMemoryTransport.createLinkedPair()
      const handle = serveStdio(() => fixture.createServer(), { transport: peer, legacy: 'reject' })
      const connection = new ClientMcpConnection(
        { name: 'test', version: '1' },
        {
          capabilities: { elicitation: { form: {}, url: {} }, roots: {}, sampling: {} },
          versionNegotiation: { mode: { pin: '2026-07-28' } }
        },
        {
          toolsChanged: vi.fn(),
          promptsChanged: vi.fn(),
          resourcesChanged: vi.fn(),
          resourceUpdated: vi.fn(),
          log: vi.fn()
        }
      )
      connection.addCloseHook(() => handle.close())
      await connection.connect(upstream)
      return connection
    })
    await runtime._doInit()
    client = await connectMcpTestClient(() => createSkillsServer(agentId, sessionId))
  })

  afterEach(async () => {
    await client?.close()
    await runtime?._doStop()
    vi.restoreAllMocks()
  })

  const reads = () => fixture.requests.filter((request) => request.startsWith('read:'))
  const load = () =>
    client.callTool({
      name: 'load_mcp_skill',
      arguments: { server_id: serverId, skill_uri: fixture.uri }
    })
  const read = (uri = factsUri) =>
    client.callTool({
      name: 'read_mcp_skill_file',
      arguments: { server_id: serverId, skill_uri: fixture.uri, resource_uri: uri }
    })
  const payload = (result: Awaited<ReturnType<Client['callTool']>>): unknown => {
    expect(result.isError).not.toBe(true)
    const block = result.content[0]
    if (block.type !== 'text') throw new Error('Expected a text tool result')
    return JSON.parse(block.text)
  }

  it('discovers metadata and loads only the entry file with its complete manifest', async () => {
    expect(payload(await client.callTool({ name: 'list_mcp_skills', arguments: {} }))).toMatchObject([
      { serverId, skills: [{ server_id: serverId, name: 'reports', skill_uri: fixture.uri }] }
    ])
    expect(reads()).toEqual([])
    expect(payload(await load())).toMatchObject({
      entry: { ...fixture.manifest(), serverId, serverName: 'Reports origin' },
      content: { uri: fixture.uri, text: fixture.files.get(fixture.uri) }
    })
    expect(reads()).toEqual([`read:${fixture.uri}`])
  })

  it('reads a supporting file without loading or reading SKILL.md first', async () => {
    expect(payload(await read())).toMatchObject({
      origin: { serverId, skillUri: fixture.uri },
      content: { uri: factsUri, text: 'Report code: CHERRY-2640\n' }
    })
    expect(reads()).toEqual([`read:${factsUri}`])
  })

  it('fetches the current manifest and bytes on every load and file read', async () => {
    payload(await load())
    payload(await read())
    const entry = `${fixture.files.get(fixture.uri)}Updated workflow.\n`
    fixture.files.set(fixture.uri, entry)
    fixture.files.set(factsUri, 'Report code: CURRENT\n')
    fixture.refresh()
    expect(payload(await read())).toMatchObject({ content: { text: 'Report code: CURRENT\n' } })
    expect(payload(await load())).toMatchObject({
      entry: fixture.manifest(),
      content: { text: entry }
    })
    expect(reads()).toEqual([`read:${fixture.uri}`, `read:${factsUri}`, `read:${factsUri}`, `read:${fixture.uri}`])
  })

  it.each(['text', 'blob'])('returns readable %s SKILL.md and preserves binary attachments', async (representation) => {
    const text = `${fixture.files.get(fixture.uri)}生成报告。\n`
    const binaryUri = 'skill://reports/assets/data.bin'
    const binary = Buffer.from([0, 255, 128, 1])
    fixture.files.set(fixture.uri, representation === 'blob' ? Buffer.from(text) : text)
    fixture.files.set(binaryUri, binary)
    fixture.refresh()
    expect(payload(await load())).toMatchObject({ content: { text } })
    expect(payload(await read(binaryUri))).toMatchObject({
      content: { uri: binaryUri, blob: binary.toString('base64') }
    })
  })

  it.each(['skill://reports/unlisted.txt', 'skill://reports/../secret.txt', 'skill://other/facts.txt'])(
    'rejects unlisted or escaped file %s before fetching its bytes',
    async (uri) => {
      expect((await read(uri)).isError).toBe(true)
      expect(reads()).toEqual([])
    }
  )

  it('rejects mismatched bytes and accepts a later read after the manifest is updated', async () => {
    fixture.files.set(factsUri, 'Changed bytes')
    const failed = await read()
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed)).toContain('digest')
    fixture.refresh()
    expect(payload(await read())).toMatchObject({ content: { text: 'Changed bytes' } })
  })

  it('rejects entry frontmatter that differs from the manifest', async () => {
    const manifest = fixture.manifest()
    manifest.frontmatter.description = 'Different description'
    fixture.publish(manifest)
    const result = await load()
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('frontmatter')
  })

  it('reports dynamic manifests without fetching content', async () => {
    fixture.publish({ ...fixture.manifest(), resources: 'dynamic' })
    expect((await load()).isError).toBe(true)
    expect((await read()).isError).toBe(true)
    expect(reads()).toEqual([])
  })

  it.each(['wrong-uri', 'multiple-resources'])('rejects a %s resource response', async (response) => {
    const create = fixture.createServer
    vi.spyOn(fixture, 'createServer').mockImplementation(() => {
      const peer = create()
      peer.setRequestHandler('resources/read', async () => ({
        contents:
          response === 'wrong-uri'
            ? [{ uri: 'skill://reports/other.txt', text: 'unexpected' }]
            : [
                { uri: factsUri, text: 'Report code: CHERRY-2640\n' },
                { uri: fixture.uri, text: 'extra' }
              ],
        ttlMs: 0,
        cacheScope: 'private'
      }))
      return peer
    })
    const result = await read()
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('exactly the requested resource')
  })

  it.each(['disabled', 'deselected', 'unknown'])('rejects a %s server before querying it', async (state) => {
    if (state === 'disabled') mcpServerService.update(serverId, { isActive: false })
    else if (state === 'deselected') agentService.updateAgent(agentId, { mcps: [] })
    else serverId = 'unknown'
    expect((await load()).isError).toBe(true)
    expect((await read()).isError).toBe(true)
    expect(fixture.requests).toEqual([])
  })

  it('keeps server identities distinct and leaves ordinary resource reads unchanged', async () => {
    payload(await load())
    const other = mcpServerService.create({
      name: 'Other origin',
      type: 'streamableHttp',
      baseUrl: 'http://127.0.0.1:2/mcp',
      isActive: true
    })
    agentService.updateAgent(agentId, { mcps: [serverId, other.id] })
    expect(
      payload(
        await client.callTool({
          name: 'read_mcp_skill_file',
          arguments: { server_id: other.id, skill_uri: fixture.uri, resource_uri: factsUri }
        })
      )
    ).toMatchObject({
      origin: { serverId: other.id },
      content: { serverId: other.id, text: 'Report code: CHERRY-2640\n' }
    })
    fixture.files.set('resource://ordinary', 'Ordinary resource')
    expect(
      await runtime.getResource({
        serverId: other.id,
        uri: 'resource://ordinary',
        interactionContext: { sessionId },
        cacheMode: 'refresh'
      })
    ).toMatchObject({ contents: [{ serverId: other.id, text: 'Ordinary resource' }] })
  })

  it('reports a failed catalog separately from an empty successful catalog', async () => {
    fixture.repeatCursor(true)
    expect(payload(await client.callTool({ name: 'list_mcp_skills', arguments: {} }))).toMatchObject([
      { serverId, skills: [], error: expect.stringContaining('Repeated') }
    ])
    fixture.repeatCursor(false)
    fixture.advertise(false)
    await runtime.stopServer(serverId)
    expect(payload(await client.callTool({ name: 'list_mcp_skills', arguments: {} }))).toEqual([
      { serverId, skills: [] }
    ])
  })
})
