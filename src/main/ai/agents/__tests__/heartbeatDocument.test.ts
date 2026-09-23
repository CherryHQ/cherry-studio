import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { PathStaleVersionError } from '@main/utils/file'

import { readHeartbeatDocument, writeHeartbeatDocument } from '../heartbeatDocument'

// Protect saved instructions against lost edits and writes outside the agent's storage.
describe('heartbeatDocument', () => {
  const dbh = setupTestDatabase()
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'heartbeat-editor-'))
    vi.mocked(application.getPath).mockReturnValue(root)
    dbh.db
      .insert(agentTable)
      .values({ id: 'a1', name: 'Test', type: 'claude-code', instructions: '', orderKey: 'a0' })
      .run()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    vi.mocked(application.getPath).mockReset()
  })

  it('creates the missing file and persists editable Markdown without changing agent configuration', async () => {
    const initial = await readHeartbeatDocument('a1')
    const saved = await writeHeartbeatDocument('a1', { ...initial, content: '- Check my inbox\n' })
    expect((await readHeartbeatDocument('a1')).content).toBe('- Check my inbox\n')
    expect(await readFile(path.join(root, 'a1', 'heartbeat.md'), 'utf8')).toBe(saved.content)
    expect(dbh.db.select().from(agentTable).all()[0].configuration).toEqual({})
  })

  it('rejects a stale edit without overwriting externally updated tasks', async () => {
    const initial = await readHeartbeatDocument('a1')
    await writeFile(path.join(root, 'a1', 'heartbeat.md'), '- external changes\n')
    await expect(writeHeartbeatDocument('a1', { ...initial, content: '- stale changes' })).rejects.toBeInstanceOf(
      PathStaleVersionError
    )
    expect((await readHeartbeatDocument('a1')).content).toBe('- external changes\n')
  })

  it('refuses a symlink replacing the checklist', async () => {
    const initial = await readHeartbeatDocument('a1')
    const outside = path.join(root, 'other.md')
    await writeFile(outside, 'Keep me')
    await rm(path.join(root, 'a1', 'heartbeat.md'))
    await symlink(outside, path.join(root, 'a1', 'heartbeat.md'))
    await expect(writeHeartbeatDocument('a1', { ...initial, content: 'Overwrite' })).rejects.toThrow()
    await expect(readHeartbeatDocument('a1')).rejects.toThrow()
    expect(await readFile(outside, 'utf8')).toBe('Keep me')
  })

  it('does not provision files for a missing or unsupported agent', async () => {
    dbh.db.insert(agentTable).values({ id: 'dsh', name: 'DSH', type: 'dsh', instructions: '', orderKey: 'a1' }).run()
    await expect(readHeartbeatDocument('../escape')).rejects.toThrow('unavailable')
    await expect(readHeartbeatDocument('dsh')).rejects.toThrow('unavailable')
    await expect(readFile(path.join(root, 'dsh', 'heartbeat.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
