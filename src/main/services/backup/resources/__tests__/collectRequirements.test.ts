import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { snapshotTo } from '@data/db/restore/snapshot'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { noteTable } from '@data/db/schemas/note'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceRoots } from '../adapters'
import { collectResourceRequirements } from '../collectRequirements'

/**
 * Real-database proof for the Phase 2b-i requirement adapters. Every fixture
 * runs the production migrations through `setupTestDatabase()` and is exported
 * with the production `snapshotTo` primitive, so the adapters see exactly the
 * detached artifact the archive ships.
 *
 * `spyOnFs` (below) is the load-bearing test in this file: the inventory is
 * existence-ORIENTED, meaning it declares what the database points at and never
 * looks at the producer's disk to decide. A single `fs` call here would make a
 * cross-device restore report the PRODUCER's coverage.
 */

const USER_DATA = '/profile/CherryStudio'

const ROOTS: ResourceRoots = {
  files: `${USER_DATA}/Data/Files`,
  knowledge: `${USER_DATA}/Data/KnowledgeBase`,
  notes: `${USER_DATA}/Data/Notes`,
  agentData: `${USER_DATA}/Data/Agents`,
  systemWorkspaces: `${USER_DATA}/Data/Agents/system`,
  skills: `${USER_DATA}/Data/Skills`,
  mcpWorkspace: `${USER_DATA}/Data/Workspace`,
  mcpMemory: `${USER_DATA}/Data/Mcp/memory.json`,
  agentChannels: `${USER_DATA}/Data/Channels`,
  agentRuntimeConfig: `${USER_DATA}/Data/Agents/.claude`
}

describe('collectResourceRequirements', () => {
  const dbh = setupTestDatabase()
  let workDir: string
  let snapshotIndex = 0

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'cs-resource-inventory-'))
    snapshotIndex = 0
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function collect() {
    const dbPath = join(workDir, `snapshot-${(snapshotIndex += 1)}.sqlite`)
    snapshotTo(dbh.sqlite, dbPath)
    return collectResourceRequirements({ dbPath, roots: ROOTS, userDataPath: USER_DATA })
  }

  function livePathsOf(kind: string, inventory: ReturnType<typeof collect>): string[] {
    return inventory.requirements.filter((r) => r.kind === kind).map((r) => r.livePath)
  }

  function insertInternalFile(id: string, ext: string | null, deletedAt?: number): void {
    dbh.db
      .insert(fileEntryTable)
      .values({ id, origin: 'internal', name: id, ext, size: 1, ...(deletedAt ? { deletedAt } : {}) })
      .run()
  }

  function insertKnowledgeBase(id: string): void {
    dbh.db
      .insert(knowledgeBaseTable)
      .values({ id, name: id, status: 'completed', chunkSize: 512, chunkOverlap: 32 })
      .run()
  }

  function insertItem(
    baseId: string,
    id: string,
    type: 'file' | 'url' | 'note' | 'directory',
    data: Record<string, unknown>,
    groupId?: string,
    status: 'completed' | 'idle' = 'completed'
  ): void {
    dbh.db
      .insert(knowledgeItemTable)
      .values({ id, baseId, type, data: data as never, status, ...(groupId ? { groupId } : {}) })
      .run()
  }

  it('declares fixed profile roots even when their database tables have no rows', () => {
    const inventory = collect()

    expect(inventory.requirements).toEqual([
      { kind: 'note-root', resourceType: 'directory', livePath: 'Data/Notes' },
      { kind: 'mcp-workspace', resourceType: 'directory', livePath: 'Data/Workspace' },
      { kind: 'mcp-memory', resourceType: 'file', livePath: 'Data/Mcp/memory.json' },
      { kind: 'agent-channel-state', resourceType: 'directory', livePath: 'Data/Channels' },
      { kind: 'agent-runtime-config', resourceType: 'directory', livePath: 'Data/Agents/.claude' }
    ])
    expect(inventory.unverifiableByKind).toEqual({
      'file-blob': 0,
      'knowledge-base': 0,
      'note-root': 0,
      'agent-data': 0,
      'agent-workspace': 0,
      skill: 0,
      'mcp-workspace': 0,
      'mcp-memory': 0,
      'agent-channel-state': 0,
      'agent-runtime-config': 0
    })
  })

  describe('file blobs', () => {
    it('declares one file requirement per live internal entry, extension included', () => {
      insertInternalFile('11111111-1111-4111-8111-111111111111', 'pdf')
      insertInternalFile('22222222-2222-4222-8222-222222222222', null)

      const inventory = collect()

      expect(livePathsOf('file-blob', inventory).sort()).toEqual([
        'Data/Files/11111111-1111-4111-8111-111111111111.pdf',
        'Data/Files/22222222-2222-4222-8222-222222222222'
      ])
      expect(inventory.requirements.every((r) => r.resourceType === 'file' || r.kind !== 'file-blob')).toBe(true)
    })

    it('counts an external entry as unverifiable and never turns its path into a requirement', () => {
      dbh.db
        .insert(fileEntryTable)
        .values({
          id: '33333333-3333-4333-8333-333333333333',
          origin: 'external',
          name: 'secret',
          ext: 'txt',
          externalPath: '/Users/someone/Documents/secret.txt'
        })
        .run()

      const inventory = collect()

      expect(livePathsOf('file-blob', inventory)).toEqual([])
      expect(inventory.unverifiableByKind['file-blob']).toBe(1)
      // The user's directory layout must not leak into the archive.
      expect(JSON.stringify(inventory.requirements)).not.toContain('someone')
    })

    it('keeps a soft-deleted internal blob recoverable from FileManager trash', () => {
      insertInternalFile('44444444-4444-4444-8444-444444444444', 'png', Date.now())

      const inventory = collect()

      expect(livePathsOf('file-blob', inventory)).toEqual(['Data/Files/44444444-4444-4444-8444-444444444444.png'])
      expect(inventory.unverifiableByKind['file-blob']).toBe(0)
    })
  })

  describe('knowledge bases', () => {
    it('declares each base as one directory unit', () => {
      insertKnowledgeBase('kb-alpha')
      insertKnowledgeBase('kb-beta')

      const inventory = collect()

      expect(inventory.requirements.filter((r) => r.kind === 'knowledge-base')).toEqual([
        { kind: 'knowledge-base', resourceType: 'directory', livePath: 'Data/KnowledgeBase/kb-alpha' },
        { kind: 'knowledge-base', resourceType: 'directory', livePath: 'Data/KnowledgeBase/kb-beta' }
      ])
    })

    it('rejects a base id that would escape its root', () => {
      insertKnowledgeBase('../../escape')

      const inventory = collect()

      expect(livePathsOf('knowledge-base', inventory)).toEqual([])
      expect(inventory.unverifiableByKind['knowledge-base']).toBe(1)
    })
  })

  describe('note roots', () => {
    it('declares the managed root once, however many rows reference it', () => {
      dbh.db
        .insert(noteTable)
        .values([
          { id: 'n-1', rootPath: ROOTS.notes, path: 'a.md', isStarred: true },
          { id: 'n-2', rootPath: ROOTS.notes, path: 'folder', isExpanded: true }
        ])
        .run()

      const inventory = collect()

      expect(inventory.requirements.filter((r) => r.kind === 'note-root')).toEqual([
        { kind: 'note-root', resourceType: 'directory', livePath: 'Data/Notes' }
      ])
    })

    it('counts a user-chosen external root as unverifiable without dropping the managed library', () => {
      dbh.db
        .insert(noteTable)
        .values({ id: 'n-3', rootPath: '/Users/someone/MyNotes', path: 'a.md', isStarred: true })
        .run()

      const inventory = collect()

      expect(livePathsOf('note-root', inventory)).toEqual(['Data/Notes'])
      expect(inventory.unverifiableByKind['note-root']).toBe(1)
    })

    it('does not capture a sibling root whose name merely starts with the managed one', () => {
      dbh.db
        .insert(noteTable)
        .values({ id: 'n-4', rootPath: `${ROOTS.notes}Backup`, path: 'a.md', isStarred: true })
        .run()

      const inventory = collect()

      expect(livePathsOf('note-root', inventory)).toEqual(['Data/Notes'])
      expect(inventory.unverifiableByKind['note-root']).toBe(1)
    })
  })

  describe('agent data', () => {
    it('declares one identity-and-memory directory per live agent', () => {
      dbh.db
        .insert(agentTable)
        .values({
          id: '11111111-1111-4111-8111-111111111111',
          type: 'agent',
          name: 'A',
          instructions: '',
          orderKey: 'a'
        })
        .run()

      const inventory = collect()

      expect(livePathsOf('agent-data', inventory)).toEqual(['Data/Agents/11111111-1111-4111-8111-111111111111'])
    })

    it('ignores soft-deleted agents whose directories are garbage', () => {
      dbh.db
        .insert(agentTable)
        .values({
          id: '22222222-2222-4222-8222-222222222222',
          type: 'agent',
          name: 'deleted',
          instructions: '',
          orderKey: 'b',
          deletedAt: Date.now()
        })
        .run()

      expect(livePathsOf('agent-data', collect())).toEqual([])
    })
  })

  describe('agent workspaces', () => {
    it('declares a workspace inside the managed root and rejects one outside it', () => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values([
          {
            id: 'w-1',
            name: 'system',
            path: `${ROOTS.systemWorkspaces}/session-1`,
            type: 'system',
            orderKey: 'a'
          },
          { id: 'w-2', name: 'mine', path: '/Users/someone/code/project', type: 'user', orderKey: 'b' }
        ])
        .run()

      const inventory = collect()

      expect(livePathsOf('agent-workspace', inventory)).toEqual(['Data/Agents/system/session-1'])
      expect(inventory.unverifiableByKind['agent-workspace']).toBe(1)
    })

    it('refuses a row that claims the workspaces root itself as one unit', () => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: 'w-3', name: 'root', path: ROOTS.systemWorkspaces, type: 'system', orderKey: 'a' })
        .run()

      const inventory = collect()

      expect(livePathsOf('agent-workspace', inventory)).toEqual([])
      expect(inventory.unverifiableByKind['agent-workspace']).toBe(1)
    })

    it('classifies by containment, not by the row-controlled type column', () => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({
          id: 'w-4',
          name: 'lying',
          path: `${ROOTS.systemWorkspaces}/session-9`,
          type: 'user',
          orderKey: 'a'
        })
        .run()

      const inventory = collect()

      expect(livePathsOf('agent-workspace', inventory)).toEqual(['Data/Agents/system/session-9'])
    })
  })

  describe('installed skills', () => {
    function insertSkill(id: string, folderName: string, source: string): void {
      dbh.db.insert(agentGlobalSkillTable).values({ id, name: id, folderName, source, contentHash: 'h' }).run()
    }

    it('declares every installed skill, builtin included — all of them live in the managed library', () => {
      insertSkill('s-1', 'pdf-tools', 'marketplace')
      insertSkill('s-2', 'cherry-basics', 'builtin')

      const inventory = collect()

      expect(livePathsOf('skill', inventory).sort()).toEqual(['Data/Skills/cherry-basics', 'Data/Skills/pdf-tools'])
    })

    it('rejects a folder name that escapes the skills root', () => {
      insertSkill('s-3', '../../../etc', 'marketplace')

      const inventory = collect()

      expect(livePathsOf('skill', inventory)).toEqual([])
      expect(inventory.unverifiableByKind.skill).toBe(1)
    })
  })

  describe('knowledge material a payload must carry', () => {
    function materialsOf(baseId: string, inventory: ReturnType<typeof collect>) {
      return inventory.requiredContent.get(`Data/KnowledgeBase/${baseId}`)
    }

    it('names the raw material of every completed leaf, indexed artifact first', () => {
      insertKnowledgeBase('kb-1')
      insertItem('kb-1', 'i-file', 'file', { source: 'a.pdf', relativePath: 'a.pdf' })
      insertItem('kb-1', 'i-processed', 'file', {
        source: 'b.docx',
        relativePath: 'b.docx',
        indexedRelativePath: 'b.md'
      })
      insertItem('kb-1', 'i-url', 'url', { source: 'https://x', url: 'https://x', relativePath: 'x.md' })
      insertItem('kb-1', 'i-note', 'note', { source: 'n', content: 'n', relativePath: 'n.md' })

      expect(materialsOf('kb-1', collect())?.slice().sort()).toEqual(['raw/a.pdf', 'raw/b.md', 'raw/n.md', 'raw/x.md'])
    })

    it('names a directory container child but not the container itself', () => {
      insertKnowledgeBase('kb-2')
      insertItem('kb-2', 'i-dir', 'directory', { source: '/tmp/docs', relativePath: 'docs' })
      insertItem('kb-2', 'i-child', 'file', { source: '/tmp/docs/c.md', relativePath: 'docs/c.md' }, 'i-dir')

      expect(materialsOf('kb-2', collect())).toEqual(['raw/docs/c.md'])
    })

    it('ignores leaves that were never indexed', () => {
      insertKnowledgeBase('kb-3')
      insertItem('kb-3', 'i-idle', 'file', { source: 'a.pdf', relativePath: 'a.pdf' }, undefined, 'idle')

      expect(materialsOf('kb-3', collect())).toEqual([])
    })

    it('marks a base unprovable when a completed leaf names no material at all', () => {
      // What a v1→v2 upgrade leaves behind: indexed content whose bytes were
      // never copied under `raw/`, so no device could ever rebuild the index.
      insertKnowledgeBase('kb-4')
      insertItem('kb-4', 'i-file', 'file', { source: 'a.pdf', relativePath: 'a.pdf' })
      insertItem('kb-4', 'i-virtual', 'url', { source: 'https://x', url: 'https://x' })

      expect(materialsOf('kb-4', collect())).toBeNull()
    })

    it('survives an archive whose item payload is not even JSON', () => {
      insertKnowledgeBase('kb-6')
      insertItem('kb-6', 'i-ok', 'file', { source: 'a.pdf', relativePath: 'a.pdf' })
      // A restoring device runs this over bytes an attacker chose; a parse
      // failure must make the base unprovable, never abort the whole inventory.
      dbh.sqlite
        .prepare(
          `INSERT INTO knowledge_item (id, base_id, type, data, status, created_at, updated_at)
           VALUES ('i-broken', 'kb-6', 'file', 'not json', 'completed', 0, 0)`
        )
        .run()

      const inventory = collect()

      expect(materialsOf('kb-6', inventory)).toBeNull()
      expect(livePathsOf('knowledge-base', inventory)).toEqual(['Data/KnowledgeBase/kb-6'])
    })

    it('declares the requirement only for kinds that ship their whole content elsewhere', () => {
      insertKnowledgeBase('kb-5')
      insertInternalFile('66666666-6666-4666-8666-666666666666', 'pdf')

      expect([...collect().requiredContent.keys()]).toEqual(['Data/KnowledgeBase/kb-5'])
    })
  })

  it('never touches the filesystem to decide a requirement', async () => {
    insertInternalFile('55555555-5555-4555-8555-555555555555', 'pdf')
    insertKnowledgeBase('kb-probe')
    insertItem('kb-probe', 'i-probe', 'file', { source: 'a.pdf', relativePath: 'a.pdf' })
    dbh.db.insert(noteTable).values({ id: 'n-probe', rootPath: ROOTS.notes, path: 'a.md', isStarred: true }).run()

    const dbPath = join(workDir, 'purity.sqlite')
    snapshotTo(dbh.sqlite, dbPath)

    const fs = await import('node:fs')
    const probes = ['existsSync', 'statSync', 'lstatSync', 'readdirSync', 'readFileSync', 'openSync'] as const
    const spies = probes.map((name) => vi.spyOn(fs, name))

    const inventory = collectResourceRequirements({ dbPath, roots: ROOTS, userDataPath: USER_DATA })

    expect(inventory.requirements.length).toBe(7)
    // `collect()` opens the snapshot through better-sqlite3 (native, not these
    // bindings), so any hit here is an adapter probing a target resource.
    for (const spy of spies) {
      expect(spy, spy.getMockName()).not.toHaveBeenCalled()
    }
  })
})
