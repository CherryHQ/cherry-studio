import { mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TreeMutationEvent } from '@shared/utils/file'

import type { DirectoryTreeBuilder } from '../builder'
import { tryTestRipgrepPath } from './ripgrepTestUtils'
import { createObservedDirectoryTree as createDirectoryTree } from './treeTestUtils'

// Production resolves ripgrep via BinaryManager (`getBinaryPath('rg')`), which
// reads cherry.bin / mise shims — neither is populated under vitest. Point it
// at the test ripgrep binary so the underlying directory scan spawns a real ripgrep.
vi.mock('@main/utils/binaryResolver', async () => {
  const { tryTestRipgrepPath: tryPath } = await import('./ripgrepTestUtils')
  const resolvedRgPath = tryPath() ?? '/nonexistent/rg'
  return {
    getBinaryPath: async (name?: string) => (name === 'rg' ? resolvedRgPath : (name ?? ''))
  }
})

vi.mock('@main/utils/binaryEnv', () => ({
  getBinaryExecutionEnv: () => ({})
}))

const ripgrepAvailable = tryTestRipgrepPath() !== null

const waitForEvent = (
  builder: DirectoryTreeBuilder,
  predicate: (e: TreeMutationEvent) => boolean,
  timeoutMs = 4000
): Promise<TreeMutationEvent> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose()
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for tree event`))
    }, timeoutMs)
    const sub = builder.onMutation((e) => {
      if (predicate(e)) {
        clearTimeout(timer)
        sub.dispose()
        resolve(e)
      }
    })
  })
}

describe.skipIf(!ripgrepAvailable)('createDirectoryTree — initial scan', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-tree-scan-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('builds and indexes a nested tree restricted to allowed extensions', async () => {
    const rootFile = path.join(tmp, 'root.md')
    const ignoredFile = path.join(tmp, 'ignored.txt')
    const subdir = path.join(tmp, 'sub')
    await mkdir(subdir)
    await writeFile(rootFile, 'root')
    await writeFile(ignoredFile, 'ignored')
    await writeFile(path.join(subdir, 'inner.md'), 'inner')

    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      expect(builder.root.path).toBe(tmp.replace(/\\/g, '/'))
      expect(builder.root.hasChild('root.md')).toBe(true)
      expect(builder.root.hasChild('ignored.txt')).toBe(false)
      expect(builder.getNode(rootFile)).toBe(builder.root.children['root.md'])
      expect(builder.getNode(ignoredFile)).toBeNull()
      expect(builder.getNode(path.join(tmp, 'missing.md'))).toBeNull()

      const sub = builder.root.children['sub']
      expect(sub?.isTreeDir() && sub.hasChild('inner.md')).toBe(true)
      expect(builder.getNode(subdir)).toBe(sub)
    } finally {
      await builder.disposeAsync()
    }
    expect(builder.getNode(rootFile)).toBeNull()
  })

  it('populates stats when withStats=true and leaves them undefined otherwise', async () => {
    await writeFile(path.join(tmp, 'a.md'), 'a')

    const withStats = await createDirectoryTree(tmp, { extensions: ['.md'], withStats: true })
    try {
      const node = withStats.getNode(path.join(tmp, 'a.md'))
      expect(node?.stats?.mtime).toBeTypeOf('number')
      expect(node?.stats?.birthtime).toBeTypeOf('number')
    } finally {
      await withStats.disposeAsync()
    }

    const withoutStats = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const node = withoutStats.getNode(path.join(tmp, 'a.md'))
      expect(node?.stats).toBeUndefined()
    } finally {
      await withoutStats.disposeAsync()
    }
  })

  it('honors the workspace .gitignore so chokidar does not EMFILE on real repos', async () => {
    // What git would skip, the watcher should skip too. The hardcoded
    // exclusion list is gone; the user's `.gitignore` drives the
    // predicate.
    await writeFile(path.join(tmp, '.gitignore'), 'node_modules\ndist\n')
    await writeFile(path.join(tmp, 'app.ts'), 'src')
    await mkdir(path.join(tmp, 'node_modules'))
    await mkdir(path.join(tmp, 'node_modules', 'lodash'))
    await writeFile(path.join(tmp, 'node_modules', 'lodash', 'index.js'), '/*lodash*/')
    await mkdir(path.join(tmp, 'dist'))
    await writeFile(path.join(tmp, 'dist', 'bundle.js'), '/*bundle*/')

    const builder = await createDirectoryTree(tmp)
    try {
      expect(builder.root.hasChild('app.ts')).toBe(true)
      expect(builder.root.hasChild('node_modules')).toBe(false)
      expect(builder.root.hasChild('dist')).toBe(false)
      expect(builder.getNode(path.join(tmp, 'node_modules', 'lodash', 'index.js'))).toBeNull()
    } finally {
      await builder.disposeAsync()
    }
  })

  it('respectGitignore=false disables both .gitignore parsing and the .git carve-out', async () => {
    // The Notes data dir opts out of gitignore semantics — surface everything.
    await writeFile(path.join(tmp, '.gitignore'), 'secret.md\n')
    await writeFile(path.join(tmp, 'visible.md'), 'ok')
    await writeFile(path.join(tmp, 'secret.md'), 'shh')

    const builder = await createDirectoryTree(tmp, { respectGitignore: false })
    try {
      expect(builder.root.hasChild('visible.md')).toBe(true)
      expect(builder.root.hasChild('secret.md')).toBe(true)
    } finally {
      await builder.disposeAsync()
    }
  })
})

describe.skipIf(!ripgrepAvailable)('createDirectoryTree — watcher mutations', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-tree-watch-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('ignores hidden files after an allowed missing root appears and observes visible artifacts', async () => {
    const root = path.join(tmp, 'system-workspace')
    const builder = await createDirectoryTree(root, { watchMissingRoot: true })
    try {
      expect(builder.root.children).toEqual({})

      const events: TreeMutationEvent[] = []
      const subscription = builder.onMutation((event) => events.push(event))
      const addedPromise = waitForEvent(
        builder,
        (event) => event.type === 'added' && event.path.endsWith('/artifact.md'),
        10_000
      )
      await mkdir(root)
      await mkdir(path.join(root, '.claude'))
      await writeFile(path.join(root, '.claude', 'plugins.json'), '{}')
      await mkdir(path.join(root, 'output'))
      await writeFile(path.join(root, 'output', '.result.json'), '{}')
      await writeFile(path.join(root, 'artifact.md'), '# Artifact')

      await addedPromise
      subscription.dispose()
      expect(events.some((event) => 'path' in event && event.path.includes('/.claude'))).toBe(false)
      expect(events.some((event) => 'path' in event && event.path.endsWith('/.result.json'))).toBe(false)
      expect(builder.getNode(path.join(root, '.claude'))).toBeNull()
      expect(builder.getNode(path.join(root, '.claude', 'plugins.json'))).toBeNull()
      expect(builder.getNode(path.join(root, 'output'))).not.toBeNull()
      expect(builder.getNode(path.join(root, 'output', '.result.json'))).toBeNull()
      expect(builder.getNode(path.join(root, 'artifact.md'))).not.toBeNull()
    } finally {
      await builder.disposeAsync()
    }
  })

  it('emits "added" when a new matching file appears on disk', async () => {
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'], withStats: true })
    try {
      const eventPromise = waitForEvent(builder, (e) => e.type === 'added' && e.path.endsWith('/added.md'))
      await writeFile(path.join(tmp, 'added.md'), 'fresh')
      const event = (await eventPromise) as Extract<TreeMutationEvent, { type: 'added' }>
      expect(event.kind).toBe('file')
      expect(event.basename).toBe('added.md')
      expect(builder.getNode(path.join(tmp, 'added.md'))).not.toBeNull()
    } finally {
      await builder.disposeAsync()
    }
  })

  it('emits "added" for newly-created sub-directories', async () => {
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const eventPromise = waitForEvent(builder, (e) => e.type === 'added' && e.path.endsWith('/sub'))
      await mkdir(path.join(tmp, 'sub'))
      const event = (await eventPromise) as Extract<TreeMutationEvent, { type: 'added' }>
      expect(event.kind).toBe('directory')
      expect(builder.getNode(path.join(tmp, 'sub'))?.isTreeDir()).toBe(true)
    } finally {
      await builder.disposeAsync()
    }
  })

  it('emits "removed" when a tracked file is deleted', async () => {
    await writeFile(path.join(tmp, 'gone.md'), 'bye')
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const eventPromise = waitForEvent(builder, (e) => e.type === 'removed' && e.path.endsWith('/gone.md'))
      await rm(path.join(tmp, 'gone.md'))
      await eventPromise
      expect(builder.getNode(path.join(tmp, 'gone.md'))).toBeNull()
      expect(builder.root.hasChild('gone.md')).toBe(false)
    } finally {
      await builder.disposeAsync()
    }
  })

  it('ignores files outside the extensions allowlist after the initial scan', async () => {
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const allEvents: TreeMutationEvent[] = []
      const sub = builder.onMutation((e) => {
        allEvents.push(e)
      })
      await writeFile(path.join(tmp, 'unwanted.txt'), 'x')
      // Race-free wait: create the matching file too, wait for it, then check.
      const expected = waitForEvent(builder, (e) => e.type === 'added' && e.path.endsWith('/wanted.md'))
      await writeFile(path.join(tmp, 'wanted.md'), 'y')
      await expected
      sub.dispose()
      expect(allEvents.some((e) => 'path' in e && e.path.endsWith('/unwanted.txt'))).toBe(false)
    } finally {
      await builder.disposeAsync()
    }
  })

  it('emits "updated" with refreshed stats when a tracked file is modified', async () => {
    const notePath = path.join(tmp, 'note.md')
    await writeFile(notePath, 'first')
    const oldTimestamp = new Date(Date.now() - 2000)
    await utimes(notePath, oldTimestamp, oldTimestamp)
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'], withStats: true })
    try {
      const before = builder.getNode(path.join(tmp, 'note.md'))
      expect(before?.stats).toBeDefined()
      const beforeMtime = before?.stats?.mtime

      const updatedPromise = waitForEvent(builder, (e) => e.type === 'updated' && e.path.endsWith('/note.md'))
      await writeFile(notePath, 'second')
      const ev = await updatedPromise

      // The mutation carries fresh stats AND the in-memory node is mutated
      // in place — both because callers may consult either source.
      expect(ev.type).toBe('updated')
      if (ev.type === 'updated') {
        expect(ev.stats.mtime).toBeGreaterThan(beforeMtime ?? 0)
      }
      const after = builder.getNode(path.join(tmp, 'note.md'))
      expect(after?.stats?.mtime).toBeGreaterThan(beforeMtime ?? 0)
    } finally {
      await builder.disposeAsync()
    }
  })

  it('surfaces a removed-then-added pair when a file is renamed in place', async () => {
    await writeFile(path.join(tmp, 'old.md'), 'x')
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const removedPromise = waitForEvent(builder, (e) => e.type === 'removed' && e.path.endsWith('/old.md'))
      const addedPromise = waitForEvent(builder, (e) => e.type === 'added' && e.path.endsWith('/new.md'))
      await rename(path.join(tmp, 'old.md'), path.join(tmp, 'new.md'))
      await removedPromise
      await addedPromise
      expect(builder.getNode(path.join(tmp, 'old.md'))).toBeNull()
      expect(builder.getNode(path.join(tmp, 'new.md'))).not.toBeNull()
    } finally {
      await builder.disposeAsync()
    }
  })

  it('rename() mutates the existing node, emits renamed, and suppresses the chokidar pair', async () => {
    await writeFile(path.join(tmp, 'old.md'), 'x')
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const beforeNode = builder.getNode(path.join(tmp, 'old.md'))
      expect(beforeNode).not.toBeNull()

      const allEvents: TreeMutationEvent[] = []
      const sub = builder.onMutation((e) => allEvents.push(e))

      const renamedPromise = waitForEvent(builder, (e) => e.type === 'renamed')
      const applied = builder.rename(path.join(tmp, 'old.md'), path.join(tmp, 'new.md'))
      expect(applied).toBe(true)
      const renamedEvent = await renamedPromise
      expect(renamedEvent).toMatchObject({
        type: 'renamed',
        basename: 'new.md'
      })

      // Identity preserved: lookup by the new path returns the same instance.
      const afterNode = builder.getNode(path.join(tmp, 'new.md'))
      expect(afterNode).toBe(beforeNode)
      expect(builder.getNode(path.join(tmp, 'old.md'))).toBeNull()

      // Do the actual FS rename and wait long enough for chokidar to have
      // had a chance to fire. Then assert no removed / added events for
      // these paths landed (dedup window swallowed them).
      await rename(path.join(tmp, 'old.md'), path.join(tmp, 'new.md'))
      await new Promise((resolve) => setTimeout(resolve, 350))

      const suppressed = allEvents.filter(
        (e) =>
          (e.type === 'removed' && e.path.endsWith('/old.md')) ||
          (e.type === 'added' && 'path' in e && e.path.endsWith('/new.md'))
      )
      expect(suppressed).toEqual([])

      sub.dispose()
    } finally {
      await builder.disposeAsync()
    }
  })

  it('rename() removes a visible node when its new path is hidden', async () => {
    const visiblePath = path.join(tmp, 'visible.md')
    const hiddenPath = path.join(tmp, '.visible.md')
    const normalizedVisiblePath = visiblePath.replace(/\\/g, '/')
    await writeFile(visiblePath, 'x')
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const events: TreeMutationEvent[] = []
      const subscription = builder.onMutation((event) => events.push(event))

      const applied = builder.rename(visiblePath, hiddenPath)

      expect(applied).toBe(true)
      expect(builder.getNode(visiblePath)).toBeNull()
      expect(builder.getNode(hiddenPath)).toBeNull()
      expect(events).toContainEqual({ type: 'removed', path: normalizedVisiblePath })

      await rename(visiblePath, hiddenPath)
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(builder.getNode(hiddenPath)).toBeNull()

      subscription.dispose()
    } finally {
      await builder.disposeAsync()
    }
  })

  it('rename() of a directory cascades descendants in the lookup map', async () => {
    await mkdir(path.join(tmp, 'old'))
    await writeFile(path.join(tmp, 'old', 'leaf.md'), 'x')
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const dirNode = builder.getNode(path.join(tmp, 'old'))
      const leafNode = builder.getNode(path.join(tmp, 'old', 'leaf.md'))
      expect(dirNode).not.toBeNull()
      expect(leafNode).not.toBeNull()

      const applied = builder.rename(path.join(tmp, 'old'), path.join(tmp, 'new'))
      expect(applied).toBe(true)

      // Identity preserved for both the renamed dir and its descendant.
      expect(builder.getNode(path.join(tmp, 'new'))).toBe(dirNode)
      expect(builder.getNode(path.join(tmp, 'new', 'leaf.md'))).toBe(leafNode)
      expect(builder.getNode(path.join(tmp, 'old'))).toBeNull()
      expect(builder.getNode(path.join(tmp, 'old', 'leaf.md'))).toBeNull()
    } finally {
      await builder.disposeAsync()
    }
  })

  it('keeps the watcher add fallback when unlink wins the rename race', async () => {
    const oldPath = path.join(tmp, 'old.md')
    const newPath = path.join(tmp, 'new.md')
    const oldNorm = oldPath.replace(/\\/g, '/')
    const newNorm = newPath.replace(/\\/g, '/')
    await writeFile(oldPath, 'retained note')
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'], withStats: true })
    try {
      let applied: boolean | undefined
      const events: TreeMutationEvent[] = []
      const subscription = builder.onMutation((event) => {
        events.push(event)
        if (event.type === 'removed' && event.path === oldNorm) {
          applied = builder.rename(oldPath, newPath)
        }
      })
      const added = waitForEvent(builder, (event) => event.type === 'added' && event.path === newNorm)
      await rename(oldPath, newPath)
      await added

      expect(applied).toBe(false)
      expect(builder.getNode(oldPath)).toBeNull()
      expect(builder.getNode(newPath)?.stats).toBeDefined()
      expect(builder.root.hasChild('new.md')).toBe(true)
      expect(events.map((event) => event.type)).toEqual(['removed', 'added'])
      expect(await readFile(newPath, 'utf8')).toBe('retained note')
      subscription.dispose()
    } finally {
      await builder.disposeAsync()
    }
  })

  it('snapshot() returns a JSON tree without parent cycles', async () => {
    await writeFile(path.join(tmp, 'a.md'), '1')
    await mkdir(path.join(tmp, 's'))
    await writeFile(path.join(tmp, 's', 'b.md'), '2')

    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const snap = builder.snapshot()
      expect(snap.kind).toBe('directory')
      expect(JSON.stringify(snap)).toMatch(/"a\.md"/)
      expect(JSON.stringify(snap)).not.toMatch(/parent/)
    } finally {
      await builder.disposeAsync()
    }
  })
})
