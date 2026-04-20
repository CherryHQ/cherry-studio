import type { SplitLayout, SplitPane } from '@shared/data/cache/cacheValueTypes'
import { describe, expect, it } from 'vitest'

import {
  collectAllPaneIds,
  findPaneById,
  findPreviewPane,
  removePaneById,
  replacePaneById,
  updatePaneInLayout,
  updateRatioAtPath
} from '../splitLayout'

const paneA: SplitPane = { type: 'leaf', paneId: 'a', url: '/chat', title: 'Chat' }
const paneB: SplitPane = { type: 'leaf', paneId: 'b', url: '/notes', title: 'Notes' }
const paneC: SplitPane = { type: 'leaf', paneId: 'c', url: '/files', title: 'Files' }

const simpleSplit: SplitLayout = {
  type: 'split',
  direction: 'horizontal',
  ratio: 50,
  children: [paneA, paneB]
}

const nestedSplit: SplitLayout = {
  type: 'split',
  direction: 'horizontal',
  ratio: 60,
  children: [
    paneA,
    {
      type: 'split',
      direction: 'vertical',
      ratio: 40,
      children: [paneB, paneC]
    }
  ]
}

describe('findPaneById', () => {
  it('finds a leaf pane', () => {
    expect(findPaneById(paneA, 'a')).toBe(paneA)
  })

  it('returns null for non-existent id', () => {
    expect(findPaneById(paneA, 'z')).toBeNull()
  })

  it('finds pane in split layout', () => {
    expect(findPaneById(simpleSplit, 'b')).toBe(paneB)
  })

  it('finds pane in nested layout', () => {
    expect(findPaneById(nestedSplit, 'c')).toBe(paneC)
  })
})

describe('replacePaneById', () => {
  it('replaces a leaf with a new node', () => {
    const newPane: SplitPane = { type: 'leaf', paneId: 'd', url: '/new', title: 'New' }
    const result = replacePaneById(simpleSplit, 'b', newPane)
    expect(result).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 50,
      children: [paneA, newPane]
    })
  })

  it('does not mutate the original', () => {
    const newPane: SplitPane = { type: 'leaf', paneId: 'd', url: '/new', title: 'New' }
    replacePaneById(simpleSplit, 'a', newPane)
    expect(simpleSplit.children[0]).toBe(paneA)
  })

  it('replaces pane in nested layout', () => {
    const newPane: SplitPane = { type: 'leaf', paneId: 'd', url: '/new', title: 'New' }
    const result = replacePaneById(nestedSplit, 'c', newPane)
    expect(findPaneById(result, 'd')).toEqual(newPane)
    expect(findPaneById(result, 'c')).toBeNull()
  })
})

describe('removePaneById', () => {
  it('returns null when removing the only leaf', () => {
    expect(removePaneById(paneA, 'a')).toBeNull()
  })

  it('returns sibling when removing from a simple split', () => {
    expect(removePaneById(simpleSplit, 'a')).toBe(paneB)
  })

  it('auto-collapses parent when removing from nested split', () => {
    const result = removePaneById(nestedSplit, 'c')
    // After removing C, the inner split collapses to just B
    expect(result).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 60,
      children: [paneA, paneB]
    })
  })

  it('returns layout unchanged for non-existent id', () => {
    expect(removePaneById(simpleSplit, 'z')).toEqual(simpleSplit)
  })
})

describe('updateRatioAtPath', () => {
  it('updates ratio at root', () => {
    const result = updateRatioAtPath(simpleSplit, [], 70)
    expect(result.type === 'split' && result.ratio).toBe(70)
  })

  it('updates ratio in nested node', () => {
    const result = updateRatioAtPath(nestedSplit, [1], 60)
    if (result.type === 'split' && result.children[1].type === 'split') {
      expect(result.children[1].ratio).toBe(60)
    } else {
      throw new Error('unexpected structure')
    }
  })

  it('ignores path on leaf', () => {
    expect(updateRatioAtPath(paneA, [0], 80)).toBe(paneA)
  })
})

describe('collectAllPaneIds', () => {
  it('returns single id for leaf', () => {
    expect(collectAllPaneIds(paneA)).toEqual(['a'])
  })

  it('returns all ids for simple split', () => {
    expect(collectAllPaneIds(simpleSplit)).toEqual(['a', 'b'])
  })

  it('returns all ids for nested split', () => {
    expect(collectAllPaneIds(nestedSplit)).toEqual(['a', 'b', 'c'])
  })
})

describe('updatePaneInLayout', () => {
  it('updates url and title of a pane', () => {
    const result = updatePaneInLayout(simpleSplit, 'a', { url: '/new', title: 'New' })
    const pane = findPaneById(result, 'a')
    expect(pane?.url).toBe('/new')
    expect(pane?.title).toBe('New')
  })

  it('does not affect other panes', () => {
    const result = updatePaneInLayout(simpleSplit, 'a', { url: '/new', title: 'New' })
    expect(findPaneById(result, 'b')).toEqual(paneB)
  })

  it('toggles the isPreview flag', () => {
    const withPreview = updatePaneInLayout(simpleSplit, 'a', { isPreview: true })
    expect(findPaneById(withPreview, 'a')?.isPreview).toBe(true)
    const promoted = updatePaneInLayout(withPreview, 'a', { isPreview: false })
    expect(findPaneById(promoted, 'a')?.isPreview).toBe(false)
  })
})

describe('findPreviewPane', () => {
  it('returns null when no preview pane exists', () => {
    expect(findPreviewPane(simpleSplit)).toBeNull()
  })

  it('returns the preview pane in a simple split', () => {
    const withPreview = updatePaneInLayout(simpleSplit, 'b', { isPreview: true })
    const preview = findPreviewPane(withPreview)
    expect(preview?.paneId).toBe('b')
    expect(preview?.isPreview).toBe(true)
  })

  it('finds preview pane in a nested layout', () => {
    const withPreview = updatePaneInLayout(nestedSplit, 'c', { isPreview: true })
    expect(findPreviewPane(withPreview)?.paneId).toBe('c')
  })

  it('returns null for a non-preview leaf', () => {
    expect(findPreviewPane(paneA)).toBeNull()
  })
})
