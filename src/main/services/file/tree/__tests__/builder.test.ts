import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { TreeMutationEvent } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDirectoryTree, type DirectoryTreeBuilder } from '../builder'

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

describe('createDirectoryTree — initial scan', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-tree-scan-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('builds a nested tree of files and directories', async () => {
    await writeFile(path.join(tmp, 'root.md'), 'root')
    await mkdir(path.join(tmp, 'sub'))
    await writeFile(path.join(tmp, 'sub', 'inner.md'), 'inner')

    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      expect(builder.root.path).toBe(tmp.replace(/\\/g, '/'))
      expect(builder.root.hasChild('root.md')).toBe(true)
      expect(builder.root.hasChild('sub')).toBe(true)
      const sub = builder.root.children['sub']
      expect(sub?.isTreeDir()).toBe(true)
      expect(sub?.isTreeDir() && sub.hasChild('inner.md')).toBe(true)
    } finally {
      builder.dispose()
    }
  })

  it('filters out files that fail the extensions allowlist', async () => {
    await writeFile(path.join(tmp, 'a.md'), 'md')
    await writeFile(path.join(tmp, 'b.txt'), 'txt')

    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      expect(builder.root.hasChild('a.md')).toBe(true)
      expect(builder.root.hasChild('b.txt')).toBe(false)
    } finally {
      builder.dispose()
    }
  })

  it('populates stats when withStats=true and leaves them undefined otherwise', async () => {
    await writeFile(path.join(tmp, 'a.md'), 'a')

    const withStats = await createDirectoryTree(tmp, { extensions: ['.md'], withStats: true })
    try {
      const node = withStats.getNode(path.join(tmp, 'a.md'))
      expect(node?.stats?.mtime).toBeTypeOf('number')
      expect(node?.stats?.birthtime).toBeTypeOf('number')
    } finally {
      withStats.dispose()
    }

    const withoutStats = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const node = withoutStats.getNode(path.join(tmp, 'a.md'))
      expect(node?.stats).toBeUndefined()
    } finally {
      withoutStats.dispose()
    }
  })

  it('keeps the path→node Map coherent with the tree', async () => {
    await writeFile(path.join(tmp, 'a.md'), 'a')
    await mkdir(path.join(tmp, 'sub'))
    await writeFile(path.join(tmp, 'sub', 'b.md'), 'b')

    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      expect(builder.getNode(path.join(tmp, 'a.md'))).toBe(builder.root.children['a.md'])
      const sub = builder.root.children['sub']
      expect(builder.getNode(path.join(tmp, 'sub'))).toBe(sub)
      expect(builder.getNode(path.join(tmp, 'missing.md'))).toBeNull()
    } finally {
      builder.dispose()
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
      builder.dispose()
    }
  })

  it('always excludes the .git directory even when .gitignore does not mention it', async () => {
    // git itself never lists `.git` in `.gitignore` — but watching it is
    // pointless and chunky, so the predicate adds it unconditionally.
    await writeFile(path.join(tmp, 'app.ts'), 'src')
    await mkdir(path.join(tmp, '.git'))
    await writeFile(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/main')

    const builder = await createDirectoryTree(tmp)
    try {
      expect(builder.root.hasChild('app.ts')).toBe(true)
      expect(builder.root.hasChild('.git')).toBe(false)
    } finally {
      builder.dispose()
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
      builder.dispose()
    }
  })
})

describe('createDirectoryTree — watcher mutations', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-tree-watch-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
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
      builder.dispose()
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
      builder.dispose()
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
      builder.dispose()
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
      builder.dispose()
    }
  })

  it('drops chokidar add events for OS-noise files (.DS_Store, Thumbs.db) — defaults match initial scan', async () => {
    // Prior to wiring chokidar's predicate to the same DEFAULT_IGNORE_PATTERNS,
    // a `.DS_Store` written *after* mount would slip into the tree even
    // though the initial ripgrep scan filtered it. No `extensions` filter
    // here so the only thing keeping these files out is the ignore predicate.
    // `includeHidden: true` removes the dotfile pre-filter as well so the
    // ignore-predicate is the *only* remaining gate.
    const builder = await createDirectoryTree(tmp, { includeHidden: true })
    try {
      const events: TreeMutationEvent[] = []
      const sub = builder.onMutation((e) => events.push(e))

      // Race-free: create a regular .txt alongside the OS-noise files, wait
      // for the legit event, then assert the OS-noise files were suppressed.
      const sentinelPromise = waitForEvent(
        builder,
        (e) => e.type === 'added' && 'path' in e && e.path.endsWith('/sentinel.txt')
      )
      await writeFile(path.join(tmp, '.DS_Store'), 'noise')
      await writeFile(path.join(tmp, 'Thumbs.db'), 'noise')
      await writeFile(path.join(tmp, 'sentinel.txt'), 'ok')
      await sentinelPromise

      const noiseEvents = events.filter(
        (e) => 'path' in e && (e.path.endsWith('/.DS_Store') || e.path.endsWith('/Thumbs.db'))
      )
      expect(noiseEvents).toEqual([])
      expect(builder.getNode(path.join(tmp, '.DS_Store'))).toBeNull()
      expect(builder.getNode(path.join(tmp, 'Thumbs.db'))).toBeNull()

      sub.dispose()
    } finally {
      builder.dispose()
    }
  })

  it('emits "updated" with refreshed stats when a tracked file is modified', async () => {
    await writeFile(path.join(tmp, 'note.md'), 'first')
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'], withStats: true })
    try {
      const before = builder.getNode(path.join(tmp, 'note.md'))
      expect(before?.stats).toBeDefined()
      const beforeMtime = before?.stats?.mtime

      // Sleep ≥1s so mtime granularity (1s on HFS+/some FSes) actually moves.
      await new Promise((resolve) => setTimeout(resolve, 1100))
      const updatedPromise = waitForEvent(builder, (e) => e.type === 'updated' && e.path.endsWith('/note.md'))
      await writeFile(path.join(tmp, 'note.md'), 'second')
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
      builder.dispose()
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
      builder.dispose()
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
      builder.dispose()
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
      builder.dispose()
    }
  })

  it('rename() returns false when the source node is missing', async () => {
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })
    try {
      const applied = builder.rename(path.join(tmp, 'missing.md'), path.join(tmp, 'whatever.md'))
      expect(applied).toBe(false)
    } finally {
      builder.dispose()
    }
  })

  it('dispose() stops the chokidar watcher so post-dispose FS changes emit nothing', async () => {
    await writeFile(path.join(tmp, 'before.md'), 'x')
    const builder = await createDirectoryTree(tmp, { extensions: ['.md'] })

    const events: TreeMutationEvent[] = []
    const sub = builder.onMutation((e) => events.push(e))

    // Quick proof the watcher is alive: a write before dispose lands.
    await writeFile(path.join(tmp, 'live.md'), 'y')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(events.some((e) => e.type === 'added' && 'path' in e && e.path.endsWith('/live.md'))).toBe(true)

    sub.dispose()
    builder.dispose()
    const eventsAtDispose = events.length

    // After dispose, further FS mutations must not surface.
    await writeFile(path.join(tmp, 'after.md'), 'z')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(events.length).toBe(eventsAtDispose)
    // And the internal lookup map is cleared.
    expect(builder.getNode(path.join(tmp, 'live.md'))).toBeNull()
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
      builder.dispose()
    }
  })
})

describe('createDirectoryTree — DB isolation', () => {
  it('the tree primitive does not import @main/data', async () => {
    // Import-graph proxy: a regex over the source files. The classes live
    // in `src/shared/file/types/tree.ts` and the main-side primitive
    // is split across `builder.ts` / `DirectoryTreeManager.ts`. None of
    // them may pull anything from `@main/data`.
    const { readFile } = await import('node:fs/promises')
    const builderSource = await readFile(new URL('../builder.ts', import.meta.url), 'utf8')
    const managerSource = await readFile(new URL('../DirectoryTreeManager.ts', import.meta.url), 'utf8')
    const sharedTreeSource = await readFile(
      new URL('../../../../../shared/file/types/tree.ts', import.meta.url),
      'utf8'
    )
    for (const src of [builderSource, managerSource, sharedTreeSource]) {
      expect(src).not.toMatch(/from\s+['"]@main\/data/)
      expect(src).not.toMatch(/from\s+['"]@data\//)
    }
  })
})
