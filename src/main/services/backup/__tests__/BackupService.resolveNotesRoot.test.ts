// resolveNotesRoot errno classification (BackupService default-root branch).
import * as fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackupService } from '../BackupService'

describe('BackupService.resolveNotesRoot errno classification', () => {
  let defaultRoot: string

  beforeEach(async () => {
    BaseService.resetInstances()
    defaultRoot = await mkdtemp(join(tmpdir(), 'cs-notes-default-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'feature.notes.data') return defaultRoot
      return `/mock/${key}`
    })
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'PreferenceService') {
        return { get: () => '' } // no custom path → managed default branch
      }
      throw new Error(`unexpected application.get(${name})`)
    }) as typeof application.get)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(defaultRoot, { recursive: true, force: true })
  })

  it('ENOENT on managed default → undefined (fresh install)', () => {
    const realStat = fs.statSync
    vi.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, opts?: fs.StatSyncOptions) => {
      if (String(p) === defaultRoot) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      return realStat(p, opts as never)
    }) as typeof fs.statSync)

    const service = new BackupService()
    const result = (service as unknown as { resolveNotesRoot: () => string | undefined }).resolveNotesRoot()
    expect(result).toBeUndefined()
  })

  it('EACCES→requireReadableDir throws, not silent undefined', () => {
    const realStat = fs.statSync
    vi.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, opts?: fs.StatSyncOptions) => {
      if (String(p) === defaultRoot) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      }
      return realStat(p, opts as never)
    }) as typeof fs.statSync)

    const service = new BackupService()
    try {
      ;(service as unknown as { resolveNotesRoot: () => string | undefined }).resolveNotesRoot()
      expect.unreachable('should throw')
    } catch (e) {
      expect((e as NodeJS.ErrnoException).code).toBe('EACCES')
    }
  })
})
