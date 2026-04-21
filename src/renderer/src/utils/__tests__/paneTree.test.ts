import type { LeafPane, PaneLayout, PaneTab } from '@shared/data/cache/cacheValueTypes'
import { describe, expect, it } from 'vitest'

import {
  collectAllLeafIds,
  collectAllTabs,
  findLeafById,
  findTabInTree,
  firstLeaf,
  moveTabBetweenLeaves,
  removeLeafById,
  replaceLeafById,
  splitLeaf,
  updateLeafById,
  updateRatioAtPath
} from '../paneTree'

const tabA: PaneTab = { id: 'a', type: 'route', url: '/chat', title: 'Chat' }
const tabB: PaneTab = { id: 'b', type: 'route', url: '/notes', title: 'Notes' }
const tabC: PaneTab = { id: 'c', type: 'route', url: '/files', title: 'Files' }

const leaf1: LeafPane = { type: 'leaf', paneId: 'p1', tabs: [tabA], activeTabId: 'a' }
const leaf2: LeafPane = { type: 'leaf', paneId: 'p2', tabs: [tabB, tabC], activeTabId: 'b' }
const leaf3: LeafPane = { type: 'leaf', paneId: 'p3', tabs: [tabC], activeTabId: 'c' }

const simpleSplit: PaneLayout = {
  type: 'split',
  direction: 'horizontal',
  ratio: 50,
  children: [leaf1, leaf2]
}

const nestedSplit: PaneLayout = {
  type: 'split',
  direction: 'horizontal',
  ratio: 60,
  children: [
    leaf1,
    {
      type: 'split',
      direction: 'vertical',
      ratio: 40,
      children: [leaf2, leaf3]
    }
  ]
}

describe('findLeafById', () => {
  it('finds a leaf at the root', () => {
    expect(findLeafById(leaf1, 'p1')).toBe(leaf1)
  })

  it('returns null when not found', () => {
    expect(findLeafById(leaf1, 'px')).toBeNull()
  })

  it('finds leaves in a simple split', () => {
    expect(findLeafById(simpleSplit, 'p2')).toBe(leaf2)
  })

  it('finds leaves nested two levels deep', () => {
    expect(findLeafById(nestedSplit, 'p3')).toBe(leaf3)
  })
})

describe('replaceLeafById', () => {
  it('replaces a leaf with a new leaf', () => {
    const replacement: LeafPane = { type: 'leaf', paneId: 'pX', tabs: [tabA], activeTabId: 'a' }
    const result = replaceLeafById(simpleSplit, 'p2', replacement)
    expect(result).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 50,
      children: [leaf1, replacement]
    })
  })

  it('does not mutate the original', () => {
    const replacement: LeafPane = { type: 'leaf', paneId: 'pX', tabs: [tabA], activeTabId: 'a' }
    replaceLeafById(simpleSplit, 'p1', replacement)
    expect(simpleSplit.children[0]).toBe(leaf1)
  })

  it('replaces leaves in a nested layout', () => {
    const replacement: LeafPane = { type: 'leaf', paneId: 'pX', tabs: [tabA], activeTabId: 'a' }
    const result = replaceLeafById(nestedSplit, 'p3', replacement)
    expect(findLeafById(result, 'pX')).toEqual(replacement)
    expect(findLeafById(result, 'p3')).toBeNull()
  })
})

describe('removeLeafById', () => {
  it('returns null when the only leaf is removed', () => {
    expect(removeLeafById(leaf1, 'p1')).toBeNull()
  })

  it('returns the sibling when one child of a split is removed', () => {
    expect(removeLeafById(simpleSplit, 'p1')).toBe(leaf2)
  })

  it('auto-collapses a nested split when a grandchild is removed', () => {
    const result = removeLeafById(nestedSplit, 'p3')
    expect(result).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 60,
      children: [leaf1, leaf2]
    })
  })

  it('leaves the tree unchanged when target is not found', () => {
    expect(removeLeafById(simpleSplit, 'px')).toEqual(simpleSplit)
  })
})

describe('updateLeafById', () => {
  it('applies the updater to a matching leaf', () => {
    const result = updateLeafById(simpleSplit, 'p1', (leaf) => ({ ...leaf, activeTabId: 'z' }))
    const updated = findLeafById(result, 'p1')
    expect(updated?.activeTabId).toBe('z')
  })

  it('leaves other leaves untouched', () => {
    const result = updateLeafById(simpleSplit, 'p1', (leaf) => ({ ...leaf, activeTabId: 'z' }))
    expect(findLeafById(result, 'p2')).toBe(leaf2)
  })

  it('is a no-op when the paneId is missing', () => {
    const result = updateLeafById(simpleSplit, 'px', (leaf) => ({ ...leaf, activeTabId: 'z' }))
    expect(result).toEqual(simpleSplit)
  })
})

describe('updateRatioAtPath', () => {
  it('updates the ratio at the root', () => {
    const result = updateRatioAtPath(simpleSplit, [], 70)
    expect(result.type === 'split' && result.ratio).toBe(70)
  })

  it('updates the ratio of a nested split', () => {
    const result = updateRatioAtPath(nestedSplit, [1], 80)
    if (result.type === 'split' && result.children[1].type === 'split') {
      expect(result.children[1].ratio).toBe(80)
    } else {
      throw new Error('unexpected shape')
    }
  })

  it('is a no-op on a leaf', () => {
    expect(updateRatioAtPath(leaf1, [0], 90)).toBe(leaf1)
  })
})

describe('collectAllLeafIds', () => {
  it('returns one id for a leaf', () => {
    expect(collectAllLeafIds(leaf1)).toEqual(['p1'])
  })

  it('returns left-to-right order for simple splits', () => {
    expect(collectAllLeafIds(simpleSplit)).toEqual(['p1', 'p2'])
  })

  it('returns depth-first left-to-right order for nested splits', () => {
    expect(collectAllLeafIds(nestedSplit)).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('collectAllTabs', () => {
  it('returns every (paneId, tab) pair across the tree', () => {
    const result = collectAllTabs(nestedSplit)
    expect(result).toEqual([
      { paneId: 'p1', tab: tabA },
      { paneId: 'p2', tab: tabB },
      { paneId: 'p2', tab: tabC },
      { paneId: 'p3', tab: tabC }
    ])
  })
})

describe('firstLeaf', () => {
  it('returns the leaf itself for a leaf', () => {
    expect(firstLeaf(leaf1)).toBe(leaf1)
  })

  it('returns the leftmost-deepest leaf', () => {
    expect(firstLeaf(nestedSplit)).toBe(leaf1)
  })
})

describe('splitLeaf', () => {
  const newLeaf: LeafPane = { type: 'leaf', paneId: 'pN', tabs: [tabA], activeTabId: 'a' }

  it('wraps the target leaf in a split with the new leaf on the right', () => {
    const result = splitLeaf(leaf1, 'p1', 'horizontal', newLeaf)
    expect(result).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 50,
      children: [leaf1, newLeaf]
    })
  })

  it('honors placement="before"', () => {
    const result = splitLeaf(leaf1, 'p1', 'horizontal', newLeaf, 'before')
    expect(result.type === 'split' && result.children[0]).toBe(newLeaf)
    expect(result.type === 'split' && result.children[1]).toBe(leaf1)
  })

  it('splits a leaf that lives inside a nested tree', () => {
    const result = splitLeaf(nestedSplit, 'p3', 'vertical', newLeaf)
    const splitAtP3 = findTabInTree(result, tabA.id)
    // newLeaf contains tabA; it should now exist alongside p3
    expect(splitAtP3).not.toBeNull()
    expect(collectAllLeafIds(result)).toEqual(['p1', 'p2', 'p3', 'pN'])
  })

  it('is a no-op if the leaf does not exist', () => {
    const result = splitLeaf(simpleSplit, 'px', 'horizontal', newLeaf)
    expect(result).toBe(simpleSplit)
  })
})

describe('findTabInTree', () => {
  it('returns the tab and its paneId', () => {
    expect(findTabInTree(simpleSplit, 'a')).toEqual({ paneId: 'p1', tab: tabA })
  })

  it('finds tabs in nested splits', () => {
    expect(findTabInTree(nestedSplit, 'c')).not.toBeNull()
  })

  it('returns null when the tab does not exist', () => {
    expect(findTabInTree(simpleSplit, 'zzz')).toBeNull()
  })
})

describe('WeakMap index', () => {
  it('returns the same cached array from collectAllLeafIds on repeated calls', () => {
    const a = collectAllLeafIds(nestedSplit)
    const b = collectAllLeafIds(nestedSplit)
    expect(a).toBe(b)
  })

  it('returns the same cached array from collectAllTabs on repeated calls', () => {
    const a = collectAllTabs(nestedSplit)
    const b = collectAllTabs(nestedSplit)
    expect(a).toBe(b)
  })

  it('rebuilds index when the root reference changes', () => {
    const first = collectAllLeafIds(nestedSplit)
    // Create a structurally-identical but reference-different tree.
    const twin: PaneLayout = {
      type: 'split',
      direction: nestedSplit.direction,
      ratio: nestedSplit.ratio,
      children: nestedSplit.children
    }
    const second = collectAllLeafIds(twin)
    expect(second).not.toBe(first) // different WeakMap keys
    expect(second).toEqual(first) // same content
  })

  it('findLeafById / findTabInTree hit the index in O(1) after first call', () => {
    // Smoke test — just asserts the API still works through the index
    const tree: PaneLayout = {
      type: 'split',
      direction: 'horizontal',
      ratio: 50,
      children: [
        { type: 'leaf', paneId: 'p1', tabs: [tabA], activeTabId: 'a' },
        { type: 'leaf', paneId: 'p2', tabs: [tabB, tabC], activeTabId: 'b' }
      ]
    }
    expect(findLeafById(tree, 'p2')?.paneId).toBe('p2')
    expect(findLeafById(tree, 'p2')?.paneId).toBe('p2') // cached
    expect(findTabInTree(tree, 'c')?.tab).toBe(tabC)
    expect(findTabInTree(tree, 'missing')).toBeNull()
  })
})

describe('moveTabBetweenLeaves', () => {
  const twoPerPane: PaneLayout = {
    type: 'split',
    direction: 'horizontal',
    ratio: 50,
    children: [
      { type: 'leaf', paneId: 'p1', tabs: [tabA, tabB], activeTabId: 'a' },
      { type: 'leaf', paneId: 'p2', tabs: [tabC], activeTabId: 'c' }
    ]
  }

  describe('same-pane reorder', () => {
    const twoTabs: LeafPane = {
      type: 'leaf',
      paneId: 'p1',
      tabs: [tabA, tabB],
      activeTabId: 'a'
    }

    it('moves a tab to a later index', () => {
      const result = moveTabBetweenLeaves(twoTabs, 'p1', 'a', 'p1', 2)
      const leaf = findLeafById(result, 'p1') as LeafPane
      expect(leaf.tabs.map((t) => t.id)).toEqual(['b', 'a'])
      expect(leaf.activeTabId).toBe('a')
    })

    it('moves a tab to an earlier index', () => {
      const result = moveTabBetweenLeaves(twoTabs, 'p1', 'b', 'p1', 0)
      const leaf = findLeafById(result, 'p1') as LeafPane
      expect(leaf.tabs.map((t) => t.id)).toEqual(['b', 'a'])
    })

    it('is a no-op when moving to the same position', () => {
      const result = moveTabBetweenLeaves(twoTabs, 'p1', 'a', 'p1', 0)
      const leaf = findLeafById(result, 'p1') as LeafPane
      expect(leaf.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    })

    it('clamps an out-of-range insertIndex', () => {
      const result = moveTabBetweenLeaves(twoTabs, 'p1', 'a', 'p1', 99)
      const leaf = findLeafById(result, 'p1') as LeafPane
      expect(leaf.tabs.map((t) => t.id)).toEqual(['b', 'a'])
    })
  })

  describe('cross-pane move', () => {
    it('moves a tab to another leaf at the given index', () => {
      const result = moveTabBetweenLeaves(twoPerPane, 'p1', 'a', 'p2', 0)
      const p2 = findLeafById(result, 'p2') as LeafPane
      expect(p2.tabs.map((t) => t.id)).toEqual(['a', 'c'])
      expect(p2.activeTabId).toBe('a')
      const p1 = findLeafById(result, 'p1') as LeafPane
      expect(p1.tabs.map((t) => t.id)).toEqual(['b'])
      expect(p1.activeTabId).toBe('b') // snapped since active was the moved tab
    })

    it('appends when insertIndex equals tabs.length', () => {
      const result = moveTabBetweenLeaves(twoPerPane, 'p1', 'b', 'p2', 1)
      const p2 = findLeafById(result, 'p2') as LeafPane
      expect(p2.tabs.map((t) => t.id)).toEqual(['c', 'b'])
    })

    it('auto-collapses the source leaf when it becomes empty', () => {
      const single: PaneLayout = {
        type: 'split',
        direction: 'horizontal',
        ratio: 50,
        children: [
          { type: 'leaf', paneId: 'p1', tabs: [tabA], activeTabId: 'a' },
          { type: 'leaf', paneId: 'p2', tabs: [tabC], activeTabId: 'c' }
        ]
      }
      const result = moveTabBetweenLeaves(single, 'p1', 'a', 'p2', 0)
      // The source leaf p1 disappears; p2 is now the root.
      expect(findLeafById(result, 'p1')).toBeNull()
      const p2 = findLeafById(result, 'p2') as LeafPane
      expect(p2.tabs.map((t) => t.id)).toEqual(['a', 'c'])
    })

    it('leaves activeTabId on source intact when a non-active tab is moved', () => {
      const result = moveTabBetweenLeaves(twoPerPane, 'p1', 'b', 'p2', 0)
      const p1 = findLeafById(result, 'p1') as LeafPane
      expect(p1.activeTabId).toBe('a')
    })
  })

  describe('invalid inputs', () => {
    it('returns the tree unchanged when source pane does not exist', () => {
      expect(moveTabBetweenLeaves(twoPerPane, 'pX', 'a', 'p2', 0)).toBe(twoPerPane)
    })

    it('returns the tree unchanged when target pane does not exist', () => {
      expect(moveTabBetweenLeaves(twoPerPane, 'p1', 'a', 'pX', 0)).toBe(twoPerPane)
    })

    it('returns the tree unchanged when the tab is not in the source pane', () => {
      expect(moveTabBetweenLeaves(twoPerPane, 'p1', 'zz', 'p2', 0)).toBe(twoPerPane)
    })
  })
})
