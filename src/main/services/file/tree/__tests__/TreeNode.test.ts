import { fromSerialized, rootFromSerialized, TreeDir, TreeDirRoot, TreeFile, TreeNode } from '@shared/file/types'
import { describe, expect, it } from 'vitest'

describe('TreeFile', () => {
  it('exposes path / basename / dirname derived from the absolute path', () => {
    const f = new TreeFile({ path: '/notes/a/b.md' })
    expect(f.path).toBe('/notes/a/b.md')
    expect(f.basename).toBe('b.md')
    expect(f.dirname).toBe('/notes/a')
    expect(f.isTreeFile()).toBe(true)
    expect(f.isTreeDir()).toBe(false)
  })

  it('serializes without children and surfaces stats when set', () => {
    const f = new TreeFile({ path: '/notes/c.md', stats: { mtime: 5, birthtime: 5 } })
    expect(f.toJSON()).toEqual({
      kind: 'file',
      path: '/notes/c.md',
      basename: 'c.md',
      stats: { mtime: 5, birthtime: 5 }
    })
  })

  it('renaming via basename setter updates path but keeps parent reference', () => {
    const dir = new TreeDir({ path: '/root' })
    const file = new TreeFile({ path: '/root/old.md' })
    dir.attachChild(file)
    file.basename = 'new.md'
    expect(file.path).toBe('/root/new.md')
    // Parent's record still keys by the *original* basename (caller must
    // detach + reattach to update the lookup key); rename via the builder
    // does so explicitly.
    expect(dir.hasChild('old.md')).toBe(true)
    expect(file.parent).toBe(dir)
  })
})

describe('TreeDir', () => {
  it('attachChild wires parent pointer and increments childCount', () => {
    const dir = new TreeDir({ path: '/root' })
    const child = new TreeFile({ path: '/root/a.md' })
    dir.attachChild(child)
    expect(dir.childCount).toBe(1)
    expect(child.parent).toBe(dir)
    expect(dir.children['a.md']).toBe(child)
  })

  it('detach removes the child and clears parent pointer', () => {
    const dir = new TreeDir({ path: '/root' })
    const child = new TreeFile({ path: '/root/a.md' })
    dir.attachChild(child)
    const detached = dir.detach('a.md')
    expect(detached).toBe(child)
    expect(child.parent).toBeNull()
    expect(dir.childCount).toBe(0)
    expect(dir.hasChild('a.md')).toBe(false)
  })

  it('nodeFromPath resolves both absolute and relative paths', () => {
    const root = new TreeDirRoot('/root')
    const sub = new TreeDir({ path: '/root/sub' })
    const leaf = new TreeFile({ path: '/root/sub/leaf.md' })
    root.attachChild(sub)
    sub.attachChild(leaf)

    expect(root.nodeFromPath('/root/sub/leaf.md')).toBe(leaf)
    expect(root.nodeFromPath('sub/leaf.md')).toBe(leaf)
    expect(root.nodeFromPath('/root/sub')).toBe(sub)
    expect(root.nodeFromPath('/elsewhere')).toBeNull()
    expect(root.nodeFromPath('sub/missing')).toBeNull()
  })

  it('adjustChildrenPaths cascades when the directory itself is renamed via setter', () => {
    const root = new TreeDirRoot('/root')
    const sub = new TreeDir({ path: '/root/old' })
    const leaf = new TreeFile({ path: '/root/old/leaf.md' })
    root.attachChild(sub)
    sub.attachChild(leaf)

    sub.path = '/root/new'

    expect(sub.path).toBe('/root/new')
    expect(leaf.path).toBe('/root/new/leaf.md')
  })

  it('sortChildren reorders folders-first then by basename', () => {
    const dir = new TreeDir({ path: '/root' })
    dir.attachChild(new TreeFile({ path: '/root/z.md' }))
    dir.attachChild(new TreeFile({ path: '/root/a.md' }))
    dir.attachChild(new TreeDir({ path: '/root/m' }))
    dir.sortChildren()
    expect(Object.keys(dir.children)).toEqual(['m', 'a.md', 'z.md'])
  })

  it('walk visits every node depth-first and respects the halt signal', () => {
    const root = new TreeDirRoot('/root')
    const sub = new TreeDir({ path: '/root/sub' })
    const leaf1 = new TreeFile({ path: '/root/sub/a.md' })
    const leaf2 = new TreeFile({ path: '/root/sub/b.md' })
    root.attachChild(sub)
    sub.attachChild(leaf1)
    sub.attachChild(leaf2)

    const visited: Array<[string, number]> = []
    root.walk((node, depth) => {
      visited.push([node.path, depth])
    })
    expect(visited).toEqual([
      ['/root', 0],
      ['/root/sub', 1],
      ['/root/sub/a.md', 2],
      ['/root/sub/b.md', 2]
    ])

    const haltedAt: string[] = []
    root.walk((node) => {
      haltedAt.push(node.path)
      return node.path !== '/root/sub'
    })
    expect(haltedAt).toEqual(['/root', '/root/sub'])
  })
})

describe('serialize / fromSerialized round-trip', () => {
  it('rebuilds the tree without parent cycles in JSON', () => {
    const root = new TreeDirRoot('/root')
    const sub = new TreeDir({ path: '/root/sub' })
    const leaf = new TreeFile({ path: '/root/sub/leaf.md', stats: { mtime: 1, birthtime: 1 } })
    root.attachChild(sub)
    sub.attachChild(leaf)

    const json = root.toJSON()
    // Sanity: no parent pointers anywhere in the wire shape.
    expect(JSON.stringify(json)).not.toMatch(/parent/)

    const rebuilt = rootFromSerialized(json)
    const rebuiltLeaf = rebuilt.nodeFromPath('/root/sub/leaf.md')
    expect(rebuiltLeaf).toBeInstanceOf(TreeFile)
    expect(rebuiltLeaf?.stats).toEqual({ mtime: 1, birthtime: 1 })
    expect(rebuiltLeaf?.parent?.path).toBe('/root/sub')
    expect(rebuiltLeaf?.parent?.parent?.path).toBe('/root')
  })

  it('preserves children order through round-trip', () => {
    const dir = new TreeDir({ path: '/root' })
    dir.attachChild(new TreeFile({ path: '/root/c.md' }))
    dir.attachChild(new TreeFile({ path: '/root/a.md' }))
    dir.attachChild(new TreeFile({ path: '/root/b.md' }))

    const json = dir.toJSON()
    const rebuilt = fromSerialized(json) as TreeDir
    expect(Object.keys(rebuilt.children)).toEqual(['c.md', 'a.md', 'b.md'])
  })
})

describe('TreeNode.setParent / remove', () => {
  it('remove() detaches from parent', () => {
    const dir = new TreeDir({ path: '/root' })
    const file = new TreeFile({ path: '/root/a.md' })
    dir.attachChild(file)
    expect(file.remove()).toBe(true)
    expect(dir.childCount).toBe(0)
    expect(file.parent).toBeNull()
  })

  it('remove() is a no-op on detached nodes', () => {
    const file = new TreeFile({ path: '/root/a.md' })
    expect(file.remove()).toBe(false)
  })

  it('TreeFile is an instance of TreeNode', () => {
    expect(new TreeFile({ path: '/x.md' })).toBeInstanceOf(TreeNode)
  })
})
