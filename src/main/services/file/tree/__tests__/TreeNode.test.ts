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

  it('renaming via basename setter repoints parent _children to the new key', () => {
    const dir = new TreeDir({ path: '/root' })
    const file = new TreeFile({ path: '/root/old.md' })
    dir.attachChild(file)
    file.basename = 'new.md'
    expect(file.path).toBe('/root/new.md')
    expect(file.basename).toBe('new.md')
    expect(file.parent).toBe(dir)
    // Parent's map is now keyed by the new name, not the old.
    expect(dir.hasChild('new.md')).toBe(true)
    expect(dir.hasChild('old.md')).toBe(false)
    expect(dir.children['new.md']).toBe(file)
    expect(dir.nodeFromPath('/root/new.md')).toBe(file)
  })

  it('renaming via path setter (same parent, new basename) also repoints _children', () => {
    const dir = new TreeDir({ path: '/root' })
    const file = new TreeFile({ path: '/root/old.md' })
    dir.attachChild(file)
    file.path = '/root/renamed.md'
    expect(file.basename).toBe('renamed.md')
    expect(dir.hasChild('renamed.md')).toBe(true)
    expect(dir.hasChild('old.md')).toBe(false)
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

  it('renaming a directory cascades to descendants and repoints both _children maps', () => {
    const root = new TreeDirRoot('/root')
    const sub = new TreeDir({ path: '/root/old' })
    const leaf = new TreeFile({ path: '/root/old/leaf.md' })
    root.attachChild(sub)
    sub.attachChild(leaf)

    sub.path = '/root/new'

    // Subtree-root path + parent map both repointed.
    expect(sub.path).toBe('/root/new')
    expect(root.hasChild('new')).toBe(true)
    expect(root.hasChild('old')).toBe(false)

    // Leaf path cascades; leaf basename does NOT change, so sub's _children
    // map key stays the same (correctly).
    expect(leaf.path).toBe('/root/new/leaf.md')
    expect(sub.hasChild('leaf.md')).toBe(true)
    expect(sub.nodeFromPath('/root/new/leaf.md')).toBe(leaf)
    expect(root.nodeFromPath('/root/new/leaf.md')).toBe(leaf)
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
