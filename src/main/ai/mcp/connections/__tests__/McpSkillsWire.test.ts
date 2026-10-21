import { InMemoryTransport } from '@modelcontextprotocol/client'
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

  it('never sends extension methods to a server without the capability', async () => {
    const fixture = createMcpSkillsFixture()
    fixture.advertise(false)
    const connection = await connect(fixture)
    try {
      expect(await connection.listSkills()).toEqual([])
      await expect(connection.getSkill(fixture.uri)).rejects.toThrow('advertise')
      await expect(connection.readSkillDirectory('skill://reports')).rejects.toThrow('directoryRead')
      expect(fixture.requests).toEqual([])
      expect((await connection.readResource(fixture.uri)).contents).toHaveLength(1)
    } finally {
      await connection.close()
    }
  })

  it('ignores the extension on a legacy connection and pages optional directory reads only when advertised', async () => {
    const fixture = createMcpSkillsFixture()
    const legacy = await connect(fixture, true)
    try {
      expect(await legacy.listSkills()).toEqual([])
      expect(fixture.requests).toEqual([])
    } finally {
      await legacy.close()
    }
    fixture.directoryRead(true)
    const modern = await connect(fixture)
    try {
      expect(await modern.readSkillDirectory('skill://reports')).toEqual([
        { uri: fixture.uri, name: 'SKILL.md', mimeType: 'text/markdown' }
      ])
      expect(fixture.requests).toEqual(['resources/directory/read', 'resources/directory/read'])
    } finally {
      await modern.close()
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
