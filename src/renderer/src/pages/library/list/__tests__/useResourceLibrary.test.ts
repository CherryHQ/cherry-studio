import type { Tag } from '@shared/data/types/tag'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceListQuery } from '../../adapters/types'
import { useResourceLibrary } from '../useResourceLibrary'

const mocks = vi.hoisted(() => ({
  useAssistantList: vi.fn(),
  useAgentList: vi.fn(),
  useSkillList: vi.fn(),
  useTagList: vi.fn()
}))

vi.mock('../../adapters/assistantAdapter', () => ({
  assistantAdapter: {
    useList: mocks.useAssistantList
  }
}))

vi.mock('../../adapters/agentAdapter', () => ({
  agentAdapter: {
    useList: mocks.useAgentList
  }
}))

vi.mock('../../adapters/skillAdapter', () => ({
  skillAdapter: {
    useList: mocks.useSkillList
  }
}))

vi.mock('../../adapters/tagAdapter', () => ({
  useTagList: mocks.useTagList
}))

function listResult(data: unknown[]) {
  return {
    data,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn()
  }
}

function createTag(id: string, name: string): Tag {
  return {
    id,
    name,
    color: '#8b5cf6',
    createdAt: '2026-04-27T00:00:00.000Z',
    updatedAt: '2026-04-27T00:00:00.000Z'
  }
}

function renderResourceLibrary(options: Partial<Parameters<typeof useResourceLibrary>[0]> = {}) {
  return renderHook(() =>
    useResourceLibrary({
      sidebarFilter: { resourceType: 'assistant' },
      activeTag: null,
      search: '',
      sort: 'updatedAt',
      ...options
    })
  )
}

describe('useResourceLibrary model display names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useAssistantList.mockReturnValue(listResult([]))
    mocks.useAgentList.mockReturnValue(listResult([]))
    mocks.useSkillList.mockReturnValue(listResult([]))
    mocks.useTagList.mockReturnValue({
      tags: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
  })

  it('uses backend-resolved model names for both assistant and agent resource cards', () => {
    mocks.useAssistantList.mockReturnValue(
      listResult([
        {
          id: 'assistant-1',
          name: 'Assistant',
          description: '',
          emoji: '💬',
          modelName: 'GPT-4o',
          tags: [],
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Agent',
          description: '',
          configuration: {},
          model: 'anthropic::claude-sonnet-4-5',
          modelName: 'Claude Sonnet 4.5',
          tags: [],
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary()

    expect(result.current.allResources.find((resource) => resource.type === 'assistant')?.model).toBe('GPT-4o')
    expect(result.current.allResources.find((resource) => resource.type === 'agent')?.model).toBe('Claude Sonnet 4.5')
  })

  it('omits the agent card model when the backend cannot resolve a modelName', () => {
    mocks.useAgentList.mockReturnValue(
      listResult([
        {
          id: 'agent-1',
          name: 'Agent',
          description: '',
          configuration: {},
          model: 'anthropic::claude-sonnet-4-5',
          modelName: null,
          tags: [],
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary()

    expect(result.current.allResources.find((resource) => resource.type === 'agent')?.model).toBeUndefined()
  })

  it('uses global tags for skill resource cards instead of source metadata tags', () => {
    const productivity = createTag('tag-1', '生产力')
    mocks.useSkillList.mockReturnValue(
      listResult([
        {
          id: 'skill-1',
          name: '网页摘要',
          description: '自动提取网页核心内容',
          folderName: 'web-summary',
          source: 'marketplace',
          sourceUrl: null,
          namespace: null,
          author: 'CherryStudio',
          tags: [productivity],
          sourceTags: ['metadata-only'],
          contentHash: 'hash',
          isEnabled: false,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    )

    const { result } = renderResourceLibrary({
      sidebarFilter: { resourceType: 'skill' }
    })
    const skill = result.current.allResources.find((resource) => resource.type === 'skill')

    expect(skill?.tags).toEqual(['生产力'])
  })

  it('passes skill search and tag filters to the backend without local filtering', () => {
    const productivity = createTag('tag-1', '生产力')
    mocks.useSkillList.mockImplementation((query?: ResourceListQuery) => {
      if (query) {
        return listResult([
          {
            id: 'skill-filtered',
            name: '后端结果',
            description: '由 /skills 返回',
            folderName: 'backend-filtered',
            source: 'marketplace',
            sourceUrl: null,
            namespace: null,
            author: null,
            tags: [],
            sourceTags: [],
            contentHash: 'filtered-hash',
            isEnabled: false,
            createdAt: '2026-04-27T00:00:00.000Z',
            updatedAt: '2026-04-27T00:00:00.000Z'
          }
        ])
      }

      return listResult([
        {
          id: 'skill-base',
          name: '网页摘要',
          description: '自动提取网页核心内容',
          folderName: 'web-summary',
          source: 'marketplace',
          sourceUrl: null,
          namespace: null,
          author: null,
          tags: [productivity],
          sourceTags: ['metadata-only'],
          contentHash: 'base-hash',
          isEnabled: false,
          createdAt: '2026-04-27T00:00:00.000Z',
          updatedAt: '2026-04-27T00:00:00.000Z'
        }
      ])
    })

    const { result } = renderResourceLibrary({
      sidebarFilter: { resourceType: 'skill' },
      activeTag: '生产力',
      search: ' summary '
    })

    expect(mocks.useSkillList.mock.calls[0]).toEqual([])
    expect(mocks.useSkillList.mock.calls[1]).toEqual([{ search: 'summary', tagIds: ['tag-1'] }])
    expect(result.current.resources.map((resource) => resource.id)).toEqual(['skill-filtered'])
  })
})
