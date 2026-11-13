import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock } = vi.hoisted(() => ({ getPathMock: vi.fn() }))

vi.mock('@application', () => ({ application: { getPath: getPathMock } }))

import { AGENT_MEMORY_CONFLICT, AGENT_MEMORY_READ_ONLY, AGENT_MEMORY_TOO_LARGE, agentHandlers } from '../agent'

const AGENT_ID = 'agent-1'
const ctx = { senderId: null }

let root: string

async function seed(agentId = AGENT_ID) {
  const agentDir = path.join(root, agentId)
  await mkdir(path.join(agentDir, 'memory'), { recursive: true })
  await writeFile(path.join(agentDir, 'SOUL.md'), '# Soul\n')
  await writeFile(path.join(agentDir, 'USER.md'), '# User\n')
  await writeFile(path.join(agentDir, 'memory', 'FACT.md'), '# Fact\n')
  await writeFile(path.join(agentDir, 'memory', 'JOURNAL.jsonl'), '{"text":"one"}\n')
  return agentDir
}

async function readFileEntry(key: 'soul' | 'user' | 'fact' | 'journal') {
  const snapshot = await agentHandlers['agent.memory.read']({ agentId: AGENT_ID }, ctx)
  return snapshot.files.find((file) => file.key === key)!
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'agent-memory-'))
  getPathMock.mockReturnValue(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('agent memory handlers', () => {
  it('reads the four identity and memory files', async () => {
    const agentDir = await seed()

    const snapshot = await agentHandlers['agent.memory.read']({ agentId: AGENT_ID }, ctx)

    expect(snapshot.directory).toBe(agentDir)
    expect(snapshot.files.map((file) => file.key)).toEqual(['soul', 'user', 'fact', 'journal'])
    expect(snapshot.files.find((file) => file.key === 'soul')).toMatchObject({
      exists: true,
      name: 'SOUL.md',
      content: '# Soul\n',
      truncated: false
    })
    expect(snapshot.files.find((file) => file.key === 'fact')?.path).toBe(path.join(agentDir, 'memory', 'FACT.md'))
    expect(snapshot.files.find((file) => file.key === 'soul')?.version).toMatch(/^\d+:/)
  })

  it('reports missing files instead of failing for an agent with no data directory', async () => {
    const snapshot = await agentHandlers['agent.memory.read']({ agentId: 'missing-agent' }, ctx)

    expect(snapshot.files).toHaveLength(4)
    expect(snapshot.files.every((file) => !file.exists && file.size === 0 && file.version === 'missing')).toBe(true)
  })

  it('writes a file atomically and returns the refreshed metadata', async () => {
    const agentDir = await seed()
    const original = await readFileEntry('fact')

    const updated = await agentHandlers['agent.memory.write'](
      {
        agentId: AGENT_ID,
        key: 'fact',
        content: '# Fact\n\nnew line\n',
        expectedVersion: original.version
      },
      ctx
    )

    expect(updated).toMatchObject({ exists: true, content: '# Fact\n\nnew line\n', truncated: false })
    expect(updated.version).not.toBe(original.version)
    await expect(readFile(path.join(agentDir, 'memory', 'FACT.md'), 'utf8')).resolves.toBe('# Fact\n\nnew line\n')
  })

  it('creates a missing memory file and its directory', async () => {
    const agentDir = await seed()
    await rm(path.join(agentDir, 'memory'), { recursive: true, force: true })

    const updated = await agentHandlers['agent.memory.write'](
      {
        agentId: AGENT_ID,
        key: 'fact',
        content: '# Created\n',
        expectedVersion: 'missing'
      },
      ctx
    )

    expect(updated).toMatchObject({ exists: true, content: '# Created\n' })
  })

  it('rejects a save when the file changed since it was loaded', async () => {
    const agentDir = await seed()
    const original = await readFileEntry('fact')
    await writeFile(path.join(agentDir, 'memory', 'FACT.md'), '# Concurrent update\n')

    await expect(
      agentHandlers['agent.memory.write'](
        { agentId: AGENT_ID, key: 'fact', content: '# Mine\n', expectedVersion: original.version },
        ctx
      )
    ).rejects.toThrow(AGENT_MEMORY_CONFLICT)
  })

  it('serializes concurrent writes carrying the same revision', async () => {
    await seed()
    const original = await readFileEntry('fact')

    const results = await Promise.allSettled([
      agentHandlers['agent.memory.write'](
        { agentId: AGENT_ID, key: 'fact', content: '# First\n', expectedVersion: original.version },
        ctx
      ),
      agentHandlers['agent.memory.write'](
        { agentId: AGENT_ID, key: 'fact', content: '# Second\n', expectedVersion: original.version },
        ctx
      )
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason.message).toContain(AGENT_MEMORY_CONFLICT)
  })

  it('rejects a draft whose UTF-8 byte length exceeds the viewer limit', async () => {
    await seed()
    const original = await readFileEntry('fact')

    await expect(
      agentHandlers['agent.memory.write'](
        { agentId: AGENT_ID, key: 'fact', content: '中'.repeat(400_000), expectedVersion: original.version },
        ctx
      )
    ).rejects.toThrow(AGENT_MEMORY_TOO_LARGE)
  })

  it('keeps the journal append-only', async () => {
    await seed()
    const journal = await readFileEntry('journal')

    await expect(
      agentHandlers['agent.memory.write'](
        { agentId: AGENT_ID, key: 'journal', content: 'replaced\n', expectedVersion: journal.version },
        ctx
      )
    ).rejects.toThrow(AGENT_MEMORY_READ_ONLY)
  })

  it('refuses to replace an oversized file', async () => {
    const agentDir = await seed()
    await writeFile(path.join(agentDir, 'memory', 'FACT.md'), 'x'.repeat(1024 * 1024 + 1))
    const oversized = await readFileEntry('fact')

    await expect(
      agentHandlers['agent.memory.write'](
        { agentId: AGENT_ID, key: 'fact', content: 'small', expectedVersion: oversized.version },
        ctx
      )
    ).rejects.toThrow(AGENT_MEMORY_TOO_LARGE)
  })

  it('never overwrites a directory or symlink at the target path', async () => {
    const agentDir = await seed()
    await rm(path.join(agentDir, 'memory', 'FACT.md'))
    await mkdir(path.join(agentDir, 'memory', 'FACT.md'))

    await expect(
      agentHandlers['agent.memory.write'](
        { agentId: AGENT_ID, key: 'fact', content: 'nope', expectedVersion: 'missing' },
        ctx
      )
    ).rejects.toThrow(/must be a real file/)
  })

  it('resolves a lowercase file name like the runtime does', async () => {
    const agentDir = await seed()
    await rm(path.join(agentDir, 'memory', 'FACT.md'))
    await writeFile(path.join(agentDir, 'memory', 'fact.md'), '# lowercase\n')

    const lower = await readFileEntry('fact')
    // Windows resolves FACT.md to the same file even when the on-disk entry is lowercase.
    expect(lower.content).toBe('# lowercase\n')

    await agentHandlers['agent.memory.write'](
      { agentId: AGENT_ID, key: 'fact', content: '# updated\n', expectedVersion: lower.version },
      ctx
    )

    await expect(readFile(path.join(agentDir, 'memory', 'fact.md'), 'utf8')).resolves.toBe('# updated\n')
    const factEntries = (await readdir(path.join(agentDir, 'memory'))).filter((entry) => /^fact\.md$/i.test(entry))
    expect(factEntries).toHaveLength(1)
  })

  it('returns the newest slice of an oversized journal', async () => {
    const agentDir = await seed()
    const oversized = `${'x'.repeat(1024 * 1024)}END-MARKER\n`
    await writeFile(path.join(agentDir, 'memory', 'JOURNAL.jsonl'), oversized)

    const snapshot = await agentHandlers['agent.memory.read']({ agentId: AGENT_ID }, ctx)
    const journal = snapshot.files.find((file) => file.key === 'journal')

    expect(journal?.truncated).toBe(true)
    expect(journal?.content.endsWith('END-MARKER\n')).toBe(true)
  })
})
