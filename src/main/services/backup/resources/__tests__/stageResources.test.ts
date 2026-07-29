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

import { CeilingExceededError, SourceDriftError } from '../../errors'
import { hashDirectoryUnit, sha256File } from '../../hashing'
import type { ResourceRequirement } from '../../manifest'
import { driftHooks } from '../../sourceDrift'
import type { ResourceRoots } from '../adapters'
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
    driftHooks.afterAncestorVerify = async () => {}
    stageResourceHooks.afterBaselineInspect = async () => {}
    stageResourceHooks.afterBaselineScan = async () => {}
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

  function roots(): ResourceRoots {
    return {
      files: join(userData, 'Data', 'Files'),
      knowledge: join(userData, 'Data', 'KnowledgeBase'),
      notes: join(userData, 'Data', 'Notes'),
      agentData: join(userData, 'Data', 'Agents'),
      systemWorkspaces: join(userData, 'Data', 'Agents', 'system'),
      skills: join(userData, 'Data', 'Skills'),
      mcpWorkspace: join(userData, 'Data', 'Workspace'),
      mcpMemory: join(userData, 'Data', 'Mcp', 'memory.json'),
      agentChannels: join(userData, 'Data', 'Channels'),
      agentRuntimeConfig: join(userData, 'Data', 'Agents', '.claude')
    }
  }

  function stage(requirements: readonly ResourceRequirement[], signal?: AbortSignal, resourceRoots?: ResourceRoots) {
    return stageResources({ requirements, userDataPath: userData, resourcesDir, roots: resourceRoots, signal })
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

  it('fails when a directory disappears between root inspection and baseline scan', async () => {
    writeSource('Data/Notes/a.md', 'A')
    stageResourceHooks.afterBaselineInspect = async (sourcePath) => {
      rmSync(sourcePath, { recursive: true, force: true })
    }

    await expect(stage([req('note-root', 'directory', 'Data/Notes')])).rejects.toBeInstanceOf(SourceDriftError)
  })

  it('immediately rechecks a directory tree before accepting its baseline', async () => {
    writeSource('Data/Notes/a.md', 'A')
    stageResourceHooks.afterBaselineScan = async () => {
      writeSource('Data/Notes/b.md', 'B')
    }

    await expect(
      captureResourceStageBaseline({
        requirements: [req('note-root', 'directory', 'Data/Notes')],
        userDataPath: userData
      })
    ).rejects.toBeInstanceOf(SourceDriftError)
  })

  it('fails the whole staging pass when a source changes after the sealed baseline', async () => {
    const source = writeSource('Data/Files/blob.pdf', 'BEFORE')
    const requirements = [req('file-blob', 'file', 'Data/Files/blob.pdf')]
    const baseline = await captureResourceStageBaseline({ requirements, userDataPath: userData })
    writeFileSync(source, 'AFTER')

    await expect(
      stageResources({ requirements, userDataPath: userData, resourcesDir, baseline })
    ).rejects.toBeInstanceOf(SourceDriftError)
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

  it('uses the agent owner policy to omit the generated skill mirror from runtime config', async () => {
    writeSource('Data/Agents/.claude/settings.json', '{"theme":"dark"}')
    writeSource('Data/Agents/.claude/skills/pdf/SKILL.md', 'DERIVED MIRROR')

    const result = await stage([req('agent-runtime-config', 'directory', 'Data/Agents/.claude')])

    expect(result.payloads).toHaveLength(1)
    expect(readFileSync(join(resourcesDir, 'Data', 'Agents', '.claude', 'settings.json'), 'utf8')).toBe(
      '{"theme":"dark"}'
    )
    expect(existsSync(join(resourcesDir, 'Data', 'Agents', '.claude', 'skills'))).toBe(false)
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

  it('fails if a seal-time degradation becomes a real resource before staging', async () => {
    const requirements = [req('file-blob', 'file', 'Data/Files/late.pdf')]
    const baseline = await captureResourceStageBaseline({ requirements, userDataPath: userData })
    writeSource('Data/Files/late.pdf', 'LATE')

    await expect(
      stageResources({ requirements, userDataPath: userData, resourcesDir, baseline })
    ).rejects.toBeInstanceOf(SourceDriftError)
  })

  it('omits a symlink standing where a managed directory belongs and discloses the whole unit', async () => {
    mkdirSync(join(userData, 'Data', 'KnowledgeBase'), { recursive: true })
    const target = join(userData, 'Data', 'KnowledgeBase', 'kb-1')
    mkdirSync(join(root, 'elsewhere'))
    symlinkSync(join(root, 'elsewhere'), target)

    const result = await stage([req('knowledge-base', 'directory', 'Data/KnowledgeBase/kb-1')])

    expect(result).toEqual({
      payloads: [],
      degradations: [
        {
          kind: 'resource:knowledge-base',
          livePath: 'Data/KnowledgeBase/kb-1',
          reason: 'external-reference'
        }
      ],
      staged: false
    })
  })

  it('materializes an internal link as ordinary payload bytes', async () => {
    writeSource('Data/Notes/targets/source.md', 'SOURCE')
    symlinkSync('targets/source.md', join(userData, 'Data', 'Notes', 'alias.md'))

    const result = await stage([req('note-root', 'directory', 'Data/Notes')])

    expect(result.degradations).toEqual([])
    expect(readFileSync(join(resourcesDir, 'Data', 'Notes', 'alias.md'), 'utf8')).toBe('SOURCE')
    expect(statSync(join(resourcesDir, 'Data', 'Notes', 'alias.md')).isFile()).toBe(true)
  })

  it('omits bad reference edges individually while preserving the rest of a directory payload', async () => {
    const external = join(root, 'external.txt')
    writeFileSync(external, 'EXTERNAL')
    writeSource('Data/Notes/kept.md', 'KEPT')
    mkdirSync(join(userData, 'Data', 'Notes', 'nested'))
    symlinkSync(external, join(userData, 'Data', 'Notes', 'external.md'))
    symlinkSync('missing.md', join(userData, 'Data', 'Notes', 'dangling.md'))
    symlinkSync('..', join(userData, 'Data', 'Notes', 'nested', 'back'))

    const result = await stage([req('note-root', 'directory', 'Data/Notes')])

    expect(result.payloads).toHaveLength(1)
    expect(readFileSync(join(resourcesDir, 'Data', 'Notes', 'kept.md'), 'utf8')).toBe('KEPT')
    expect(result.degradations).toEqual([
      {
        kind: 'resource-entry:note-root',
        livePath: 'Data/Notes/dangling.md',
        reason: 'dangling-reference'
      },
      {
        kind: 'resource-entry:note-root',
        livePath: 'Data/Notes/external.md',
        reason: 'external-reference'
      },
      {
        kind: 'resource-entry:note-root',
        livePath: 'Data/Notes/nested/back',
        reason: 'cyclic-reference'
      }
    ])
  })

  it('excludes only a managed workspace skill projection while preserving a real same-name directory', async () => {
    writeSource('Data/Skills/find-skills/SKILL.md', 'CANONICAL')
    writeSource('Data/Agents/system/session/workspace.txt', 'WORKSPACE')
    mkdirSync(join(userData, 'Data', 'Agents', 'system', 'session', '.claude', 'skills'), { recursive: true })
    symlinkSync(
      join(userData, 'Data', 'Skills', 'find-skills'),
      join(userData, 'Data', 'Agents', 'system', 'session', '.claude', 'skills', 'find-skills')
    )
    writeSource('Data/Agents/system/session/.claude/skills/local-skill/SKILL.md', 'REAL WORKSPACE-LOCAL DIRECTORY')

    const result = await stage([req('agent-workspace', 'directory', 'Data/Agents/system/session')], undefined, roots())

    expect(result.degradations).toEqual([])
    expect(
      existsSync(join(resourcesDir, 'Data', 'Agents', 'system', 'session', '.claude', 'skills', 'find-skills'))
    ).toBe(false)
    expect(
      readFileSync(
        join(resourcesDir, 'Data', 'Agents', 'system', 'session', '.claude', 'skills', 'local-skill', 'SKILL.md'),
        'utf8'
      )
    ).toBe('REAL WORKSPACE-LOCAL DIRECTORY')
  })

  it('fails if an omitted reference changes after the sealed baseline', async () => {
    const first = join(root, 'first.txt')
    const second = join(root, 'second.txt')
    writeFileSync(first, 'FIRST')
    writeFileSync(second, 'SECOND')
    writeSource('Data/Notes/kept.md', 'KEPT')
    const link = join(userData, 'Data', 'Notes', 'external.md')
    symlinkSync(first, link)
    const requirements = [req('note-root', 'directory', 'Data/Notes')]
    const baseline = await captureResourceStageBaseline({ requirements, userDataPath: userData })

    rmSync(link)
    symlinkSync(second, link)

    await expect(
      stageResources({ requirements, userDataPath: userData, resourcesDir, baseline })
    ).rejects.toBeInstanceOf(SourceDriftError)
    expect(existsSync(join(resourcesDir, 'Data', 'Notes'))).toBe(false)
  })

  it('discloses an ordinary file standing where a managed directory belongs', async () => {
    mkdirSync(join(userData, 'Data', 'KnowledgeBase'), { recursive: true })
    writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), 'NOT A BASE')

    const result = await stage([req('knowledge-base', 'directory', 'Data/KnowledgeBase/kb-1')])
    expect(result.payloads).toEqual([])
    expect(result.degradations[0].reason).toBe('type-mismatch-at-snapshot')
  })

  it('fails when a file changes while it is being staged', async () => {
    const source = writeSource('Data/Files/blob.pdf', 'ORIGINAL')
    driftHooks.afterStagePreVerify = async () => {
      writeFileSync(source, 'REWRITTEN')
    }

    await expect(stage([req('file-blob', 'file', 'Data/Files/blob.pdf')])).rejects.toBeInstanceOf(SourceDriftError)
  })

  it('fails when a directory ancestor disappears during staging', async () => {
    writeSource('Data/Notes/a/1.md', 'ONE')
    writeSource('Data/Notes/b/2.md', 'TWO')
    driftHooks.beforeAncestorVerify = async (_sourceDir, fileRel) => {
      if (fileRel === 'b/2.md') rmSync(join(userData, 'Data', 'Notes'), { recursive: true })
    }

    await expect(stage([req('note-root', 'directory', 'Data/Notes')])).rejects.toBeInstanceOf(SourceDriftError)
    expect(() => readFileSync(join(resourcesDir, 'Data', 'Notes', 'a', '1.md'))).toThrow()
  })

  it('removes a failed deeply nested unit before propagating source drift', async () => {
    writeSource('Data/Files/stable.pdf', 'STABLE')
    writeSource('Data/Agents/system/2026-07-28/session-1/session.json', 'SESSION')
    driftHooks.afterStagePreVerify = async (sourcePath) => {
      if (sourcePath.endsWith('session.json')) writeSource('Data/Agents/system/2026-07-28/session-1/new.json', 'NEW')
    }

    await expect(
      stage([
        req('file-blob', 'file', 'Data/Files/stable.pdf'),
        req('agent-workspace', 'directory', 'Data/Agents/system/2026-07-28/session-1')
      ])
    ).rejects.toBeInstanceOf(SourceDriftError)

    expect(existsSync(join(resourcesDir, 'Data', 'Agents'))).toBe(false)
    expect(existsSync(join(resourcesDir, 'Data', 'Files', 'stable.pdf'))).toBe(true)
  })

  it('rejects a changed directory instead of publishing the stable prefix alone', async () => {
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

    await expect(
      stageResources({ requirements, userDataPath: userData, resourcesDir, baseline })
    ).rejects.toBeInstanceOf(SourceDriftError)

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
