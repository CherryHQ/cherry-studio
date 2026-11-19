import { CLIENT_CAPABILITIES_META_KEY, InMemoryTransport, LOG_LEVEL_META_KEY } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createMcpSkillsFixture } from '@test-helpers/mcpSkills'
import { describe, expect, it, vi } from 'vitest'

import { verifyMcpSkillFile } from '@main/ai/skills/mcpSkillContent'

import { ClientMcpConnection } from '../ClientMcpConnection'

async function connect(fixture: ReturnType<typeof createMcpSkillsFixture>, legacy = false) {
  const [client, server] = InMemoryTransport.createLinkedPair()
  const handle = serveStdio(() => fixture.createServer(), { transport: server, legacy: legacy ? 'serve' : 'reject' })
  const connection = new ClientMcpConnection(
    { name: 'test', version: '1' },
    {
      capabilities: { elicitation: { form: {}, url: {} }, roots: {}, sampling: {} },
      versionNegotiation: { mode: legacy ? 'legacy' : { pin: '2026-07-28' } }
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
  await connection.connect(client)
  return connection
}

describe('MCP Skills wire contract', () => {
  it('preserves per-call capabilities and logging metadata on SDK skill lookup', async () => {
    const fixture = createMcpSkillsFixture()
    const createServer = fixture.createServer
    const metadata: unknown[] = []
    fixture.createServer = () => {
      const server = createServer()
      const fallback = server.fallbackRequestHandler!
      server.fallbackRequestHandler = (request, context) => {
        metadata.push(context.mcpReq.envelope)
        return fallback(request, context)
      }
      return server
    }
    const connection = await connect(fixture)
    try {
      expect(
        await connection.getSkill(fixture.uri, {
          signal: new AbortController().signal,
          timeoutMs: 1_000,
          interactionContext: { roots: [], requestRoots: async () => true }
        })
      ).toEqual(fixture.manifest())
      expect(metadata).toEqual([
        expect.objectContaining({
          [LOG_LEVEL_META_KEY]: 'info',
          [CLIENT_CAPABILITIES_META_KEY]: { roots: {} }
        })
      ])
    } finally {
      await connection.close()
    }
  })

  it('pages the catalog without fetching files, then verifies a requested file', async () => {
    const fixture = createMcpSkillsFixture()
    const connection = await connect(fixture)
    try {
      const skills = await connection.listSkills()
      expect(skills).toEqual([fixture.manifest()])
      expect(fixture.requests).toEqual(['skills/list', 'skills/list'])
      const entry = await connection.getSkill(fixture.uri)
      const result = await connection.readResource(entry.uri, 'refresh')
      const content = result.contents[0]
      expect(content).toHaveProperty('text', fixture.files.get(fixture.uri))
      if (!('text' in content)) throw new Error('Expected text')
      verifyMcpSkillFile(entry, entry.uri, Buffer.from(content.text))
      fixture.files.set(entry.uri, 'unverified replacement')
      const changed = await connection.readResource(entry.uri, 'refresh')
      const changedContent = changed.contents[0]
      if (!('text' in changedContent)) throw new Error('Expected text')
      expect(() => verifyMcpSkillFile(entry, entry.uri, Buffer.from(changedContent.text))).toThrow('verification')
    } finally {
      await connection.close()
    }
  })

  it.each(['file:///shared/reports', 'file://localhost/shared/reports', 'https://example.com/reports'])(
    'discovers and reads %s through the MCP connection',
    async (root) => {
      const fixture = createMcpSkillsFixture()
      const original = fixture.manifest()
      const entry = {
        ...original,
        uri: `${root}/SKILL.md`,
        resources: original.resources.map((resource) => ({
          ...resource,
          uri: resource.uri.replace('skill://reports', root)
        }))
      }
      fixture.publish(entry)
      fixture.files.set(entry.uri, fixture.files.get(original.uri)!)
      const connection = await connect(fixture)
      try {
        expect(await connection.listSkills()).toContainEqual(entry)
        expect(await connection.getSkill(entry.uri)).toEqual(entry)
        const result = await connection.readResource(entry.uri, 'refresh')
        expect(result.contents[0]).toMatchObject({ uri: entry.uri, text: fixture.files.get(original.uri) })
        expect(fixture.requests).toContain(`read:${entry.uri}`)
      } finally {
        await connection.close()
      }
    }
  )

  it('never sends extension methods to a server without the capability', async () => {
    const fixture = createMcpSkillsFixture()
    fixture.advertise(false)
    const connection = await connect(fixture)
    try {
      expect(await connection.listSkills()).toEqual([])
      await expect(connection.getSkill(fixture.uri)).rejects.toThrow('advertise')
      expect(fixture.requests).toEqual([])
      expect((await connection.readResource(fixture.uri)).contents).toHaveLength(1)
    } finally {
      await connection.close()
    }
  })

  it('ignores the extension on a legacy connection', async () => {
    const fixture = createMcpSkillsFixture()
    const legacy = await connect(fixture, true)
    try {
      expect(await legacy.listSkills()).toEqual([])
      expect(fixture.requests).toEqual([])
    } finally {
      await legacy.close()
    }
  })

  it.each(['', 'x'.repeat(1025)])('rejects an invalid catalog description', async (description) => {
    const fixture = createMcpSkillsFixture()
    const entry = fixture.manifest()
    fixture.publish({ ...entry, frontmatter: { ...entry.frontmatter, description } })
    const connection = await connect(fixture)
    try {
      await expect(connection.listSkills()).rejects.toThrow('description')
    } finally {
      await connection.close()
    }
  })

  it('rejects a repeated pagination cursor instead of looping forever', async () => {
    const fixture = createMcpSkillsFixture()
    fixture.repeatCursor(true)
    const connection = await connect(fixture)
    try {
      await expect(connection.listSkills()).rejects.toThrow('Repeated')
    } finally {
      await connection.close()
    }
  })
})
