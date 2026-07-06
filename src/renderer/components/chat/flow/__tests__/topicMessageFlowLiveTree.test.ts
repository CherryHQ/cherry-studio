import type { CherryMessagePart, CherryUIMessage, TreeNode, TreeResponse } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { buildTopicMessageFlowLiveState, mergeTopicMessageFlowLiveTree } from '../topicMessageFlowLiveTree'

const createdAt = '2026-05-22T00:00:00.000Z'

function treeNode({ id, ...overrides }: Partial<TreeNode> & Pick<TreeNode, 'id'>): TreeNode {
  return {
    id,
    // Roots hang off the unrendered virtual root; use a non-node sentinel id.
    parentId: 'vroot',
    role: 'user',
    preview: id,
    modelId: null,
    status: 'success',
    createdAt,
    hasChildren: false,
    ...overrides
  }
}

function uiMessage({
  id,
  parts = [],
  ...metadata
}: Pick<CherryUIMessage, 'id' | 'role'> & {
  parts?: CherryMessagePart[]
  parentId?: string | null
  status?: 'pending' | 'success' | 'error' | 'paused'
  siblingsGroupId?: number
  modelId?: string
  createdAt?: string
}): CherryUIMessage {
  return {
    id,
    role: metadata.role,
    parts,
    metadata: {
      parentId: metadata.parentId,
      status: metadata.status,
      siblingsGroupId: metadata.siblingsGroupId,
      modelId: metadata.modelId,
      createdAt: metadata.createdAt ?? createdAt
    }
  } as CherryUIMessage
}

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart

describe('topicMessageFlowLiveTree', () => {
  it('adds reserved turn nodes and overlays live assistant preview/status', () => {
    const tree: TreeResponse = {
      activeNodeId: 'root',
      rootId: null,
      nodes: [treeNode({ id: 'root', hasChildren: true })],
      siblingsGroups: []
    }
    const liveState = buildTopicMessageFlowLiveState({
      topicId: 'topic-1',
      messages: [
        uiMessage({ id: 'user-1', role: 'user', parentId: 'root', parts: [textPart('new question')] }),
        uiMessage({ id: 'assistant-1', role: 'assistant', parentId: 'user-1', status: 'pending' })
      ],
      partsByMessageId: {
        'assistant-1': [textPart('streaming answer')]
      },
      activeNodeId: 'assistant-1',
      streamingMessageIds: new Set(['assistant-1'])
    })

    const merged = mergeTopicMessageFlowLiveTree(tree, liveState)

    expect(merged.activeNodeId).toBe('assistant-1')
    expect(merged.nodes.map((node) => [node.id, node.parentId, node.preview, node.status])).toEqual([
      ['root', 'vroot', 'root', 'success'],
      ['user-1', 'root', 'new question', 'success'],
      ['assistant-1', 'user-1', 'streaming answer', 'pending']
    ])
    expect(merged.nodes.find((node) => node.id === 'user-1')?.hasChildren).toBe(true)
  })

  it('groups live multi-model assistant placeholders without changing the data API shape', () => {
    const tree: TreeResponse = {
      activeNodeId: 'user-1',
      rootId: null,
      nodes: [treeNode({ id: 'user-1', hasChildren: true })],
      siblingsGroups: []
    }
    const liveState = buildTopicMessageFlowLiveState({
      topicId: 'topic-1',
      messages: [
        uiMessage({
          id: 'assistant-a',
          role: 'assistant',
          parentId: 'user-1',
          siblingsGroupId: 7,
          modelId: 'provider/model-a',
          status: 'pending'
        }),
        uiMessage({
          id: 'assistant-b',
          role: 'assistant',
          parentId: 'user-1',
          siblingsGroupId: 7,
          modelId: 'provider/model-b',
          status: 'pending'
        })
      ],
      partsByMessageId: {
        'assistant-b': [textPart('model b is responding')]
      },
      activeNodeId: 'assistant-b',
      streamingMessageIds: new Set(['assistant-a', 'assistant-b'])
    })

    const merged = mergeTopicMessageFlowLiveTree(tree, liveState)

    expect(merged.nodes.map((node) => node.id)).toEqual(['user-1'])
    expect(merged.siblingsGroups).toHaveLength(1)
    expect(merged.siblingsGroups[0]).toMatchObject({
      parentId: 'user-1',
      siblingsGroupId: 7
    })
    expect(merged.siblingsGroups[0].nodes.map((node) => [node.id, node.preview, node.status])).toEqual([
      ['assistant-a', '', 'pending'],
      ['assistant-b', 'model b is responding', 'pending']
    ])
  })

  it('groups live root siblings so the flow canvas can render multiple root trees', () => {
    const tree: TreeResponse = {
      activeNodeId: 'root-original',
      rootId: null,
      nodes: [treeNode({ id: 'root-original', preview: 'original root', hasChildren: true })],
      siblingsGroups: []
    }
    const liveState = buildTopicMessageFlowLiveState({
      topicId: 'topic-1',
      messages: [
        uiMessage({
          id: 'root-edited',
          role: 'user',
          // First-turn live message hangs off the topic's virtual root (never null).
          parentId: 'vroot',
          siblingsGroupId: 11,
          parts: [textPart('edited root')]
        }),
        uiMessage({
          id: 'assistant-edited',
          role: 'assistant',
          parentId: 'root-edited',
          status: 'pending'
        })
      ],
      partsByMessageId: {
        'assistant-edited': [textPart('edited answer streaming')]
      },
      activeNodeId: 'assistant-edited',
      streamingMessageIds: new Set(['assistant-edited'])
    })

    const merged = mergeTopicMessageFlowLiveTree(tree, liveState)

    expect(merged.nodes.map((node) => [node.id, node.parentId])).toEqual([
      ['root-original', 'vroot'],
      ['assistant-edited', 'root-edited']
    ])
    expect(merged.siblingsGroups).toHaveLength(1)
    expect(merged.siblingsGroups[0]).toMatchObject({
      parentId: 'vroot',
      siblingsGroupId: 11
    })
    expect(merged.siblingsGroups[0].nodes.map((node) => [node.id, node.preview, node.hasChildren])).toEqual([
      ['root-edited', 'edited root', true]
    ])
  })

  it('returns the original tree when live state is cleared after final history refresh', () => {
    const tree: TreeResponse = {
      activeNodeId: 'assistant-1',
      rootId: null,
      nodes: [
        treeNode({ id: 'user-1', preview: 'question', hasChildren: true }),
        treeNode({
          id: 'assistant-1',
          parentId: 'user-1',
          role: 'assistant',
          preview: 'final 50 character preview',
          status: 'success'
        })
      ],
      siblingsGroups: []
    }

    expect(mergeTopicMessageFlowLiveTree(tree, null)).toBe(tree)
  })

  it('overrides the active node without adding live nodes', () => {
    const tree: TreeResponse = {
      activeNodeId: 'assistant-1',
      rootId: null,
      nodes: [
        treeNode({ id: 'user-1', preview: 'question', hasChildren: true }),
        treeNode({
          id: 'assistant-1',
          parentId: 'user-1',
          role: 'assistant',
          preview: 'old active',
          status: 'success'
        }),
        treeNode({
          id: 'assistant-2',
          parentId: 'user-1',
          role: 'assistant',
          preview: 'next active',
          status: 'success'
        })
      ],
      siblingsGroups: []
    }

    const merged = mergeTopicMessageFlowLiveTree(tree, {
      topicId: 'topic-1',
      activeNodeId: 'assistant-2',
      nodes: []
    })

    expect(merged).not.toBe(tree)
    expect(merged.activeNodeId).toBe('assistant-2')
    expect(merged.nodes.map((node) => node.id)).toEqual(['user-1', 'assistant-1', 'assistant-2'])
  })
})
