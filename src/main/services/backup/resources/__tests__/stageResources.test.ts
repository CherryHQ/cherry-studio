import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CeilingExceededError } from '../../errors'
import { hashDirectoryUnit, sha256File } from '../../hashing'
import type { ResourceRequirement } from '../../manifest'
import { driftHooks } from '../../sourceDrift'
import {
  captureResourceStageBaseline,
  measureResourceStageBytes,
  stageResourceHooks,
  stageResources
} from '../stageResources'

/**
 * What the Full producer promises about its payloads (§1.7, §5.4): every unit it
 * declares is captured byte-exactly, everything it cannot capture is DISCLOSED
 * rather than dropped, and anything that moves under its feet fails the export
 * instead of shipping an archive that cannot say which version it holds.
 */

describe('stageResources', () => {
  let root = ''
  let userData = ''
  let resourcesDir = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-stage-res-'))
    userData = join(root, 'userData')
    resourcesDir = join(root, 'staging', 'resources')
    mkdirSync(userData, { recursive: true })
    mkdirSync(join(root, 'staging'), { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    driftHooks.afterStagePreVerify = async () => {}
    driftHooks.beforeAncestorVerify = async () => {}
    stageResourceHooks.afterBaselineInspect = async () => {}
  })

  function req(kind: string, resourceType: 'file' | 'directory', livePath: string): ResourceRequirement {
    return { kind, resourceType, livePath }
  }

  function writeSource(relPath: string, content: string): string {
    const abs = join(userData, ...relPath.split('/'))
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
    return abs
  }

  function stage(requirements: readonly ResourceRequirement[], signal?: AbortSignal) {
    return stageResources({ requirements, userDataPath: userData, resourcesDir, signal })
  }

  it('measures file and directory work without creating staging output', async () => {
    writeSource('Data/Files/blob.pdf', 'FILE')
    writeSource('Data/KnowledgeBase/kb-1/raw/doc.txt', 'SOURCE')
    writeSource('Data/KnowledgeBase/kb-1/.cherry/index.sqlite', 'DERIVED')

    const bytes = await measureResourceStageBytes({
      requirements: [
        req('file-blob', 'file', 'Data/Files/blob.pdf'),
        req('knowledge-base', 'directory', 'Data/KnowledgeBase/kb-1')
      ],
      userDataPath: userData
    })

    expect(bytes).toBe('FILE'.length + 'SOURCE'.length)
    expect(() => readFileSync(resourcesDir)).toThrow()
  })

  it('captures a file unit with the hash of the bytes it staged', async () => {
    const source = writeSource('Data/Files/blob.pdf', 'ATTACHMENT')

    const result = await stage([req('file-blob', 'file', 'Data/Files/blob.pdf')])

    expect(result.payloads).toEqual([
      {
        kind: 'file-blob',
        resourceType: 'file',
        archivePath: 'resources/Data/Files/blob.pdf',
        livePath: 'Data/Files/blob.pdf',
        hash: await sha256File(source),
        sizeBytes: 'ATTACHMENT'.length,
        executable: false
      }
    ])
    expect(readFileSync(join(resourcesDir, 'Data', 'Files', 'blob.pdf'), 'utf8')).toBe('ATTACHMENT')
  })

  it('carries only the safe executable bit for a file unit', async () => {
    const source = writeSource('Data/Files/tool.sh', '#!/bin/sh\necho ok\n')
    chmodSync(source, 0o755)

    const result = await stage([req('file-blob', 'file', 'Data/Files/tool.sh')])

    expect(result.payloads).toMatchObject([{ resourceType: 'file', executable: true }])
    expect(statSync(join(resourcesDir, 'Data', 'Files', 'tool.sh')).mode & 0o777).toBe(0o700)
  })

  it('omits a directory that disappears between root inspection and baseline scan', async () => {
    writeSource('Data/Notes/a.md', 'A')
    stageResourceHooks.afterBaselineInspect = async (sourcePath) => {
      rmSync(sourcePath, { recursive: true, force: true })
    }

    const result = await stage([req('note-root', 'directory', 'Data/Notes')])

    expect(result.payloads).toEqual([])
    expect(result.degradations).toEqual([
      { kind: 'resource:note-root', livePath: 'Data/Notes', reason: 'changed-after-snapshot' }
    ])
  })

  it('omits a source changed after the database snapshot baseline', async () => {
    const source = writeSource('Data/Files/blob.pdf', 'BEFORE')
    const requirements = [req('file-blob', 'file', 'Data/Files/blob.pdf')]
    const baseline = await captureResourceStageBaseline({ requirements, userDataPath: userData })
    writeFileSync(source, 'AFTER')

    await expect(
      stageResources({ requirements, userDataPath: userData, resourcesDir, baseline })
    ).resolves.toMatchObject({
      payloads: [],
      degradations: [{ livePath: 'Data/Files/blob.pdf', reason: 'changed-after-snapshot' }]
    })
  })

  it('content-addresses a directory unit with the canonical unit hash', async () => {
    writeSource('Data/KnowledgeBase/kb-1/raw/doc.txt', 'SOURCE')
    writeSource('Data/KnowledgeBase/kb-1/meta.json', '{}')

    const result = await stage([req('knowledge-base', 'directory', 'Data/KnowledgeBase/kb-1')])

    // The same digest admission will recompute over the extracted tree — the
    // producer and the consumer share one scanner, so this must agree.
    const staged = await hashDirectoryUnit(join(resourcesDir, 'Data', 'KnowledgeBase', 'kb-1'))
    expect(result.payloads[0]).toMatchObject({
      resourceType: 'directory',
      archivePath: 'resources/Data/KnowledgeBase/kb-1',
      hash: staged.hash,
      sizeBytes: 'SOURCE'.length + '{}'.length
    })
  })

  it('leaves the Knowledge derived index out of the payload entirely', async () => {
    writeSource('Data/KnowledgeBase/kb-1/raw/doc.txt', 'SOURCE')
    writeSource('Data/KnowledgeBase/kb-1/.cherry/index.sqlite', 'INDEX')

    const result = await stage([req('knowledge-base', 'directory', 'Data/KnowledgeBase/kb-1')])

    // Excluded from the bytes AND from the size: it is rebuilt after restore
    // (§6.7), so shipping it would only transport stale derived state.
    const stagedUnit = await hashDirectoryUnit(join(resourcesDir, 'Data', 'KnowledgeBase', 'kb-1'))
    expect(stagedUnit.files.map((file) => file.relPath)).toEqual(['raw/doc.txt'])
    expect(result.payloads[0].sizeBytes).toBe('SOURCE'.length)
  })

  describe('material a restored device could rebuild from', () => {
    const KB_1 = 'Data/KnowledgeBase/kb-1'

    function stageWithMaterial(required: readonly string[] | null, extra: readonly ResourceRequirement[] = []) {
      return stageResources({
        requirements: [req('knowledge-base', 'directory', KB_1), ...extra],
        userDataPath: userData,
        resourcesDir,
        requiredContent: new Map([[KB_1, required]])
      })
    }

    it('ships a base whose declared material is all present', async () => {
      writeSource(`${KB_1}/raw/doc.txt`, 'SOURCE')
      writeSource(`${KB_1}/raw/sub/other.md`, 'MORE')
      writeSource(`${KB_1}/.cherry/index.sqlite`, 'INDEX')

      const result = await stageWithMaterial(['raw/doc.txt', 'raw/sub/other.md'])

      const staged = await hashDirectoryUnit(join(resourcesDir, 'Data', 'KnowledgeBase', 'kb-1'))
      expect(staged.files.map((file) => file.relPath)).toEqual(['raw/doc.txt', 'raw/sub/other.md'])
      expect(result.degradations).toEqual([])
    })

    it('excludes the whole base when one declared material is missing', async () => {
      writeSource(`${KB_1}/raw/doc.txt`, 'SOURCE')
      writeSource(`${KB_1}/.cherry/index.sqlite`, 'INDEX')

      // The index is excluded from the archive, so material the database says was
      // indexed is the only thing the target could rebuild from. Half a base is
      // an index that describes files it does not contain.
      const result = await stageWithMaterial(['raw/doc.txt', 'raw/gone.pdf'])

      expect(result.payloads).toEqual([])
      expect(result.staged).toBe(false)
      expect(result.degradations).toEqual([
        { kind: 'resource:knowledge-base', livePath: KB_1, reason: 'unrebuildable-content' }
      ])
      expect(existsSync(join(resourcesDir, 'Data', 'KnowledgeBase', 'kb-1'))).toBe(false)
    })

    it('excludes a base whose material cannot be named at all', async () => {
      writeSource(`${KB_1}/raw/doc.txt`, 'SOURCE')

      const result = await stageWithMaterial(null)

      expect(result.payloads).toEqual([])
      expect(result.degradations[0].reason).toBe('unrebuildable-content')
    })

    it('keeps staging the units that are still whole', async () => {
      writeSource(`${KB_1}/raw/doc.txt`, 'SOURCE')
      writeSource('Data/Files/blob.pdf', 'FILE')

      const result = await stageWithMaterial(['raw/gone.pdf'], [req('file-blob', 'file', 'Data/Files/blob.pdf')])

      expect(result.payloads.map((payload) => payload.livePath)).toEqual(['Data/Files/blob.pdf'])
      // The excluded unit's bytes must not be charged to the archive either.
      expect(result.payloads[0].sizeBytes).toBe('FILE'.length)
    })

    it('counts none of an unrebuildable unit toward the staging estimate', async () => {
      writeSource(`${KB_1}/raw/doc.txt`, 'SOURCE')

      const bytes = await measureResourceStageBytes({
        requirements: [req('knowledge-base', 'directory', KB_1)],
        userDataPath: userData,
        requiredContent: new Map([[KB_1, ['raw/gone.pdf']]])
      })

      expect(bytes).toBe(0)
    })
  })

  it('discloses a resource that is already gone instead of failing the export', async () => {
    writeSource('Data/Files/here.pdf', 'HERE')

    const result = await stage([
      req('file-blob', 'file', 'Data/Files/here.pdf'),
      req('file-blob', 'file', 'Data/Files/gone.pdf')
    ])

    // The other 5,000 attachments still deserve a backup.
    expect(result.payloads.map((payload) => payload.livePath)).toEqual(['Data/Files/here.pdf'])
    expect(result.degradations).toEqual([
      { kind: 'resource:file-blob', livePath: 'Data/Files/gone.pdf', reason: 'absent-at-snapshot' }
    ])
  })

  it.each([
    ['a symlink', 'symlink'],
    ['a file', 'file']
  ])('discloses %s standing where a managed directory belongs', async (_label, kind) => {
    mkdirSync(join(userData, 'Data', 'KnowledgeBase'), { recursive: true })
    const target = join(userData, 'Data', 'KnowledgeBase', 'kb-1')
    if (kind === 'symlink') {
      mkdirSync(join(root, 'elsewhere'))
      symlinkSync(join(root, 'elsewhere'), target)
    } else {
      writeFileSync(target, 'NOT A BASE')
    }

    const result = await stage([req('knowledge-base', 'directory', 'Data/KnowledgeBase/kb-1')])

    // Same rule the restoring device applies in `coverage.ts`: a node that is not
    // the declared kind is not that resource.
    expect(result.payloads).toEqual([])
    expect(result.degradations[0].reason).toBe('type-mismatch-at-snapshot')
  })

  it('omits a file that changes while it is being staged', async () => {
    const source = writeSource('Data/Files/blob.pdf', 'ORIGINAL')
    driftHooks.afterStagePreVerify = async () => {
      writeFileSync(source, 'REWRITTEN')
    }

    await expect(stage([req('file-blob', 'file', 'Data/Files/blob.pdf')])).resolves.toMatchObject({
      payloads: [],
      degradations: [{ livePath: 'Data/Files/blob.pdf', reason: 'changed-after-snapshot' }]
    })
  })

  it('omits a directory whose next ancestor disappears during staging', async () => {
    writeSource('Data/Notes/a/1.md', 'ONE')
    writeSource('Data/Notes/b/2.md', 'TWO')
    driftHooks.beforeAncestorVerify = async (_sourceDir, fileRel) => {
      if (fileRel === 'b/2.md') rmSync(join(userData, 'Data', 'Notes'), { recursive: true })
    }

    const result = await stage([req('note-root', 'directory', 'Data/Notes')])

    expect(result.payloads).toEqual([])
    expect(result.degradations).toEqual([
      { kind: 'resource:note-root', livePath: 'Data/Notes', reason: 'changed-after-snapshot' }
    ])
    expect(() => readFileSync(join(resourcesDir, 'Data', 'Notes', 'a', '1.md'))).toThrow()
  })

  it('removes orphaned structural parents after omitting a deeply nested unit', async () => {
    writeSource('Data/Files/stable.pdf', 'STABLE')
    writeSource('Data/Agents/system/2026-07-28/session-1/session.json', 'SESSION')
    driftHooks.afterStagePreVerify = async (sourcePath) => {
      if (sourcePath.endsWith('session.json')) writeSource('Data/Agents/system/2026-07-28/session-1/new.json', 'NEW')
    }

    const result = await stage([
      req('file-blob', 'file', 'Data/Files/stable.pdf'),
      req('agent-workspace', 'directory', 'Data/Agents/system/2026-07-28/session-1')
    ])

    expect(result.payloads.map((payload) => payload.livePath)).toEqual(['Data/Files/stable.pdf'])
    expect(result.degradations).toEqual([
      {
        kind: 'resource:agent-workspace',
        livePath: 'Data/Agents/system/2026-07-28/session-1',
        reason: 'changed-after-snapshot'
      }
    ])
    expect(existsSync(join(resourcesDir, 'Data', 'Agents'))).toBe(false)
    expect(existsSync(join(resourcesDir, 'Data', 'Files', 'stable.pdf'))).toBe(true)
  })

  it('omits a changed directory as one atomic unit while retaining a stable later unit', async () => {
    const stable = writeSource('Data/Files/stable.pdf', 'STABLE')
    writeSource('Data/Notes/a.md', 'A')
    const requirements = [
      req('file-blob', 'file', 'Data/Files/stable.pdf'),
      req('note-root', 'directory', 'Data/Notes')
    ]
    const baseline = await captureResourceStageBaseline({ requirements, userDataPath: userData })
    driftHooks.afterStagePreVerify = async (sourcePath) => {
      if (sourcePath.endsWith('Data/Notes/a.md')) writeSource('Data/Notes/new.md', 'NEW')
    }

    const result = await stageResources({ requirements, userDataPath: userData, resourcesDir, baseline })

    expect(result.payloads.map((payload) => payload.livePath)).toEqual(['Data/Files/stable.pdf'])
    expect(result.degradations).toEqual([
      { kind: 'resource:note-root', livePath: 'Data/Notes', reason: 'changed-after-snapshot' }
    ])
    expect(readFileSync(stable, 'utf8')).toBe('STABLE')
    expect(() => readFileSync(join(resourcesDir, 'Data', 'Notes', 'a.md'))).toThrow()
  })

  it('refuses a payload set whose destinations overlap, before staging anything', async () => {
    writeSource('Data/Notes/a.md', 'A')
    writeSource('Data/Notes/sub/b.md', 'B')

    // Installing one unit inside another would produce a recursive mixture of old
    // and backup content on restore (§7); admission rejects it too, so producing
    // it at all would only defer the failure to the user's restore.
    await expect(
      stage([req('note-root', 'directory', 'Data/Notes'), req('note-root', 'directory', 'Data/Notes/sub')])
    ).rejects.toThrow(/ancestor-overlap/)
  })

  it('refuses more units than a restore could ever install', async () => {
    const requirements = Array.from({ length: 50_001 }, (_, index) =>
      req('file-blob', 'file', `Data/Files/blob-${index}`)
    )

    await expect(stage(requirements)).rejects.toBeInstanceOf(CeilingExceededError)
  })

  it('stops at the first cancellation checkpoint', async () => {
    writeSource('Data/Files/blob.pdf', 'ATTACHMENT')
    const controller = new AbortController()
    controller.abort()

    await expect(stage([req('file-blob', 'file', 'Data/Files/blob.pdf')], controller.signal)).rejects.toThrow(/cancel/i)
  })
})
