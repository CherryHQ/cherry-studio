import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArchiveContext } from '../admitArchive'
import { BackupArchiveCorruptError, RestoreStagingNotImplementedError } from '../errors'
import { stageRestoreResources } from '../stageRestoreResources'

describe('stageRestoreResources', () => {
  let userData: string
  let workDir: string
  let skillsRoot: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-restore-resources-'))
    workDir = join(userData, 'restore-staging', 'rst-1')
    skillsRoot = join(userData, 'Data', 'Skills')
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      const root = key === 'app.userdata' ? userData : key === 'feature.agents.skills' ? skillsRoot : undefined
      if (!root) throw new Error(`unexpected path key: ${key}`)
      return filename ? join(root, filename) : root
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(userData, { recursive: true, force: true })
  })

  const metadata = (
    overrides: Partial<ArchiveContext['resourceMetadata']> = {}
  ): ArchiveContext['resourceMetadata'] => ({
    fileIds: [],
    knowledgeBases: [],
    skillFolders: [],
    notePaths: [],
    ...overrides
  })

  it('emits dir-add entries for archived skill folders', () => {
    const stagedSkill = join(workDir, 'skills', 'local-skill')
    mkdirSync(stagedSkill, { recursive: true })

    const entries = stageRestoreResources(
      metadata({ skillFolders: [{ folderName: 'local-skill', contentHash: 'hash' }] }),
      workDir
    )

    expect(entries).toEqual([
      {
        kind: 'dir-add',
        stagingPath: join('restore-staging', 'rst-1', 'skills', 'local-skill'),
        livePath: join('Data', 'Skills', 'local-skill')
      }
    ])
  })

  it('keeps an existing local skill directory (no clobber)', () => {
    mkdirSync(join(workDir, 'skills', 'same-skill'), { recursive: true })
    mkdirSync(join(skillsRoot, 'same-skill'), { recursive: true })

    const entries = stageRestoreResources(
      metadata({ skillFolders: [{ folderName: 'same-skill', contentHash: 'hash' }] }),
      workDir
    )

    expect(entries).toEqual([])
  })

  it('rejects a missing manifest skill directory', () => {
    expect(() =>
      stageRestoreResources(metadata({ skillFolders: [{ folderName: 'missing', contentHash: 'hash' }] }), workDir)
    ).toThrow(BackupArchiveCorruptError)
  })

  it('keeps unsupported resource kinds fail-closed', () => {
    expect(() => stageRestoreResources(metadata({ fileIds: ['file-1'] }), workDir)).toThrow(
      RestoreStagingNotImplementedError
    )
  })
})
