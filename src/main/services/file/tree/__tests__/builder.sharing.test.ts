import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type { DirectoryTreeOptions, TreeMutationEvent } from '@shared/utils/file'

import { FileObservationManager } from '../../FileObservationManager'
import * as watcherModule from '../../watcher'
import { createDirectoryTree, type DirectoryTreeBuilder } from '../builder'

// The initial fixture contains only .gitignore; exercise additions through the real watcher.
vi.mock('../search', () => ({ listDirectory: async () => [] }))

describe('directory tree shared watcher policies', () => {
  let root: string
  let observations: FileObservationManager
  const builders: DirectoryTreeBuilder[] = []

  beforeEach(async () => {
    // Exercise real filesystem filtering without depending on native notification timing.
    vi.stubEnv('CHOKIDAR_USEPOLLING', '1')
    root = await mkdtemp(path.join(tmpdir(), 'cherry-tree-policy-'))
    BaseService.resetInstances()
    observations = new FileObservationManager()
    await observations._doInit()
    builders.length = 0
  })

  afterEach(async () => {
    await Promise.all(builders.map((builder) => builder.disposeAsync()))
    await observations._doStop()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  async function open(options: DirectoryTreeOptions) {
    const builder = await createDirectoryTree(root, options, (watchRoot, watchOptions, policyKey) =>
      observations.acquireWatcher(watchRoot, watchOptions, policyKey)
    )
    builders.push(builder)
    return builder
  }

  it.each(['file', 'directory'] as const)('delivers newly permitted %s additions to a later builder', async (kind) => {
    await writeFile(path.join(root, '.gitignore'), 'late*\n')
    const old = await open({ watchMissingRoot: false })
    await writeFile(path.join(root, '.gitignore'), '')
    const current = await open({ watchMissingRoot: true })
    const events: TreeMutationEvent[] = []
    current.onMutation((event) => events.push(event))
    const target = kind === 'file' ? path.join(root, 'late-new.txt') : path.join(root, 'late-dir', 'nested.txt')
    if (kind === 'directory') await mkdir(path.dirname(target))
    await writeFile(target, 'new file')

    await vi.waitFor(
      () => {
        expect(current.getNode(target)?.isTreeFile()).toBe(true)
        expect(events.some((event) => event.type === 'added' && event.path === target.replace(/\\/g, '/'))).toBe(true)
      },
      { timeout: 4000 }
    )
    expect(old.getNode(target)).toBeNull()
  })

  it('shares identical loaded policies and keeps delivery after one builder is disposed', async () => {
    const watcherFactory = vi.spyOn(watcherModule, 'createDirectoryWatcher')
    await writeFile(path.join(root, '.gitignore'), 'ignored*\n')
    const first = await open({ watchMissingRoot: false })
    const second = await open({ watchMissingRoot: true })
    expect(watcherFactory.mock.results).toHaveLength(1)
    const target = path.join(root, 'visible.txt')
    await writeFile(target, 'first')
    await vi.waitFor(
      () => {
        expect(first.getNode(target)?.isTreeFile()).toBe(true)
        expect(second.getNode(target)?.isTreeFile()).toBe(true)
      },
      { timeout: 4000 }
    )
    await first.disposeAsync()
    const later = path.join(root, 'later.txt')
    await writeFile(later, 'second')
    await vi.waitFor(() => expect(second.getNode(later)?.isTreeFile()).toBe(true), { timeout: 4000 })
  })
})
